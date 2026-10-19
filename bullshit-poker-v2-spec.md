# BullShit Poker V2 Specification

Status: Approved for implementation\
Product direction: Kinetic Cardroom\
Production target: `https://bullshit-poker-v2.every-day.workers.dev/`\
V1 production target, frozen and out of scope: `https://bullshit-poker.every-day.workers.dev/`

## 1. Purpose

BullShit Poker V2 is a separately deployed evolution of the existing game. It keeps the proven poker rules and server-authoritative gameplay model while rebuilding the surrounding product experience: identity, room lifecycle, player departure, rematches, social feedback, history, responsive UI, accessibility, reliability, security, and deployment safety.

V2 must feel faster and richer without using visual complexity to hide state. Every accepted gameplay action remains decided by the authoritative room server.

## 2. Non-Negotiable Constraints

- Do not update, rename, redeploy, rebind, or migrate the V1 Worker.
- Do not reuse the V1 Durable Object namespace or any V1 persistent room state.
- Do not reuse a V1 D1 database if one is later added to V1.
- Do not change the locked poker claim order, evaluation, final-claim behavior, penalty threshold, or next-round starter rotation.
- Do not restore turn timers or timeout penalties.
- Do not expose another player's unrevealed cards to any client, account service, analytics event, log, or history record.
- Do not make Google login mandatory. Guest play remains fully supported.
- Do not allow UI animation, sound, Three.js, reconnection, or account services to become authoritative for game state.
- Do not delete a player record from an active match when the player leaves. Mark the player as voluntarily left so history and round integrity remain correct.
- Do not keep an abandoned room alive only because bot seats remain.

## 3. Deployment Isolation

### 3.1 V1

- Worker name: `bullshit-poker`
- URL: `https://bullshit-poker.every-day.workers.dev/`
- Existing Wrangler configuration remains untouched.
- Existing Durable Object namespace remains untouched.
- Existing deployed version remains available throughout V2 development.

### 3.2 V2

- Worker name: `bullshit-poker-v2`
- URL: `https://bullshit-poker-v2.every-day.workers.dev/`
- V2 has its own project directory, package lock, build output, Wrangler configuration, secrets, bindings, Durable Object class/namespace, and D1 database.
- Every V2 deploy command must explicitly run from the V2 project or specify the V2 Wrangler file.
- Preview URLs stay disabled unless explicitly enabled for a test deployment.
- A deployment smoke test must verify the returned page identifies itself as V2 before the production V2 deploy is considered complete.

## 4. Locked Gameplay Rules

The V1 engine behavior is the V2 compatibility contract.

### 4.1 Match Basics

- Two to ten seated players may begin a match.
- Humans and server-side bots use the same authoritative action validators.
- Every active player starts with one card.
- A penalty adds one card.
- A player is eliminated when their card count becomes greater than five.
- The last active player wins immediately.
- A fresh standard 52-card deck is cryptographically shuffled for each round.

### 4.2 Claim Order

From lowest hand category to highest:

1. High Card
2. Pair
3. Two Pair
4. Three of a Kind
5. Straight
6. Flush
7. Full House
8. Four of a Kind
9. Straight Flush
10. Royal Flush

- Two Pair compares the higher pair and then the lower pair.
- Full House compares the three-of-a-kind rank and then the pair rank.
- Regular Flush uses the locked reversed high-card ordering: a lower valid flush high-card claim is considered higher.
- Straight Flush uses normal poker high-card ordering.
- Royal Flush suits are equal for claim ordering.
- Every submitted claim must be strictly higher than the accepted current claim.

### 4.3 BullShit Calls

- Any active player except the current claimant may call BullShit while the current claim response window is open.
- The first BullShit call atomically accepted by the server wins the race.
- If the claim is true, the accepted caller receives the penalty.
- If the claim is false, the claimant receives the penalty.
- Later calls or claims targeting a closed response window are rejected as stale and receive the latest state.

### 4.4 Final Decision

- When play returns to the round's decision anchor and a claim already exists, that player may call BullShit or make a strictly higher final claim.
- A final claim is evaluated immediately and opens no BullShit response window.
- A false final claim penalizes the final claimant.
- A true final claim ends the round with no penalty.
- All round cards are revealed in either case.

### 4.5 Next Round Starter

- The next round starter rotates clockwise from the previous round's immutable rotation anchor.
- Eliminated and voluntarily left players are skipped.
- Disconnecting does not remove a player from the rotation.

### 4.6 No Turn Timeout

- There is no gameplay countdown or timeout penalty.
- Legacy timer fields may be read during compatibility migration but never block an action.
- UI transitions and automatic reveal delays are not gameplay turn timers.

## 5. Technical Architecture

### 5.1 Language and Runtime

- TypeScript remains the primary language for shared rules, Worker code, Durable Objects, and the React client.
- TypeScript must remain strict.
- Cloudflare runtime types must be generated from the V2 Wrangler configuration.
- Rust/WebAssembly is not part of the initial architecture. It may be considered only for a benchmark-proven isolated computation bottleneck.
- UI text must use a localization dictionary instead of being scattered as hard-coded component strings.

### 5.2 Application Layers

1. Pure shared engine: cards, shuffle, claims, evaluation, seat order, lifecycle transitions, and views.
2. Durable room authority: serialized mutations, private state delivery, scheduled tasks, sessions, and room cleanup.
3. Account/history service: optional authentication, profiles, preferences, and archived match summaries in D1.
4. Worker router: static assets, authentication routes, room routing, WebSocket upgrades, authenticated commands, and health endpoints.
5. React client: entry, profile home, lobby, table, sheets, winner/abandoned results, settings, and PWA state.
6. Visual scene layer: lazy-loaded Three.js scenes that never own gameplay state.

### 5.3 Source Boundaries

- No React component may import hidden authoritative room state.
- No Worker route may implement claim comparison or evaluation independently.
- No D1 history write may run before the authoritative Durable Object transition commits.
- Visual state may lag or animate, but accepted state must always reconcile to the latest server view.
- Network/session logic must live outside screen components.
- Components should remain focused and generally below 300 lines.

## 6. Identity and Accounts

### 6.1 Guest Play

- Guest creation/join uses room code, display name, and a four-digit PIN.
- A guest refresh or accidental browser navigation recovers the same seat with a valid reconnect session.
- Manual recovery uses the same normalized display name and matching PIN.
- Raw PINs are never stored or logged.
- PIN verification uses a cryptographic server-secret construction and per-seat salt.
- Failed PIN verification is rate-limited per room, normalized name, and network signal.

### 6.2 Optional Google Account

- The entry experience offers `Continue with Google` and `Play as Guest`.
- Google authentication requests only `openid`, `email`, and `profile`.
- The application never requests Gmail, Drive, Calendar, Contacts, or other Google API scopes.
- A signed-in account may set an independent in-game display name.
- Email and provider subject are never included in public room views.
- Authentication uses secure, HttpOnly, SameSite cookies.
- OAuth client secrets and auth secrets exist only as Cloudflare secrets.
- A signed-in player reclaims an account-linked seat without re-entering the guest PIN.
- Google login may be unavailable until production OAuth credentials are configured; guest mode must remain functional.

### 6.3 Seat Sessions

- Account authentication and room-seat authorization are separate concepts.
- Joining a room issues a short-lived or rotatable seat session bound to `roomId`, `matchId`, `playerId`, and account identity or guest verifier.
- WebSocket authorization must not expose a long-lived reconnect secret in a query string.
- Replacing a live session for the same seat closes the previous socket with a specific session-replaced reason.
- Leaving a match revokes the seat session, not the player's global Google/account session.

## 7. Room and Match Lifecycle

Room phases:

```text
Lobby
RoundActive
ResolvingRound
GameOver
Abandoned
Closed
```

Each room contains a current `matchId`. Rematch creates a new `matchId` inside the same room code after returning to the lobby.

Player participation states:

```text
Seated
Disconnected
Eliminated
Left
```

- `Disconnected` is recoverable and remains part of the active match.
- `Eliminated` is a connected or disconnected spectator and may still be host.
- `Left` is permanent for the current match and cannot return as active.
- A left player may authenticate later as a spectator until the room is closed.

## 8. Robust Leave Game Flow

### 8.1 User Experience

- During Lobby, RoundActive, ResolvingRound, GameOver, and eliminated spectator views, a clearly accessible Leave Game control is available.
- During gameplay it appears as a 44 by 44 icon button in the stable header, outside claim controls.
- The control has an accessible name and tooltip.
- Activating it opens a focus-trapped confirmation card:
  - `Do you want to leave the game?`
  - `No`
  - `Yes`
- Default focus is `No`.
- Escape selects `No`.
- `No` closes the card and performs no server action.
- `Yes` changes the dialog into a non-dismissible `Leaving...` pending state and disables repeated submission.
- Redirect occurs only after authoritative success or after a state sync proves the seat already left.
- A recoverable network failure keeps the user on a clear retry/status surface.

### 8.2 Browser Navigation

- In-app route navigation or browser Back from a live game opens the leave confirmation.
- Reload, process termination, lost network, and closing the browser are disconnects, not intentional leaves.
- `beforeunload` must not be trusted to commit a leave.
- Refresh and accidental Back remain recoverable through the seat session.

### 8.3 Command Contract

`LEAVE_GAME` contains:

```ts
type LeaveGameCommand = {
  type: "LEAVE_GAME";
  requestId: string;
  roomId: string;
  matchId: string;
};
```

- `playerId` is derived from the authenticated socket/session and is not trusted from the request body.
- Leave intentionally does not require an exact state revision because a player must be able to leave while state changes.
- `matchId` is required so a delayed old leave cannot remove a player from a rematch.
- The room stores a bounded receipt for processed leave request IDs.
- Replaying the same request returns the original success result.
- A second request with a new ID from an already-left seat also returns success without another mutation.

### 8.4 Atomic Transition

The authoritative transition must atomically:

1. Validate the room, match, authenticated seat, and command.
2. Return the prior receipt if already processed.
3. Mark the player `Left` with `leftAt` and departure reason.
4. Revoke room-seat reconnect credentials.
5. Remove the player from future actionable seat order.
6. Preserve the player record, card count, accepted claims, and history.
7. Recalculate current turn and final-decision anchor when required.
8. Transfer host when required.
9. Determine winner or abandonment.
10. Persist state and idempotency receipt together.
11. Broadcast player-specific views.
12. Acknowledge and close the departing room session.

### 8.5 Frozen Round Participants

- Every round stores immutable `roundParticipantIds` and an immutable `rotationAnchorPlayerId`.
- A player leaving mid-round becomes ineligible to act immediately.
- Their already-dealt cards remain in that round's evaluation pool and reveal.
- Their cards are excluded from future rounds.
- The top-bar card total represents cards in the current frozen round while a round is active.
- Leaving can never turn a previously accepted claim from true to false, or false to true, merely by withdrawing cards.

### 8.6 Turn and Anchor Rules

- Non-current player leaves: current turn is unchanged.
- Current player leaves: current turn moves clockwise to the next active seat.
- Rotation anchor leaves: the immutable rotation anchor remains for determining the next round starter.
- Final-decision anchor leaves: the final-decision anchor moves clockwise to the next active seat.
- If the transferred final-decision anchor is now the current player and a claim exists, that player receives the final decision immediately.
- Current claimant leaves: their accepted claim remains current and challengeable.
- A penalty later assigned to a left claimant is still recorded in history and may update their final card count, but cannot reactivate them.

### 8.7 Phase Races

- Leave accepted before a claim: later claim from that seat is rejected as `PLAYER_LEFT`.
- Claim accepted before leave: claim remains accepted, then leave applies to the resulting latest state.
- Leave accepted before BullShit: a call from that seat is rejected; calls from others remain valid.
- BullShit accepted before leave: resolution commits first, then leave applies to ResolvingRound or GameOver.
- Leave during ResolvingRound: existing result remains immutable; player is excluded from the next deal.
- Automatic next round accepted first: leave applies to the newly started round and that player's newly dealt cards remain frozen for that round.
- Leave accepted first: next-round deal excludes the player.
- Old leave arrives after rematch: reject as `MATCH_CHANGED` and do not mutate the new match.

### 8.8 Population Outcomes

- More than one active human/bot remains: game continues normally.
- Exactly one active player remains: transition immediately to GameOver with that player as winner.
- No active players remain but at least one human spectator has not left: transition to GameOver without fabricating a winner.
- Every human has explicitly left: transition to Abandoned and begin deletion, regardless of bots.
- Bots are cancelled and never keep an abandoned room alive.

### 8.9 Host Transfer

- An eliminated host remains host until they explicitly leave.
- On host leave, transfer clockwise to the next connected human.
- If none is connected, transfer clockwise to the next human who has not explicitly left.
- Bots never become host.
- If no human remains, abandon and delete the room.

### 8.10 Failure Recovery

- Client retains the pending `requestId` until success is known.
- If the socket closes after send, reconnect/sync checks seat status before retrying.
- If state says `Left`, treat the original leave as successful and redirect.
- If state says active, retry the same request ID.
- If the room no longer exists, treat a pending leave as successful.
- Client never clears its room credential before authoritative confirmation or room-not-found proof.

## 9. Room Deletion and Retention

### 9.1 Explicit Abandonment

When all humans explicitly leave:

1. Commit Abandoned state and the final leave receipt.
2. Stop bot and automatic-round scheduling.
3. Revoke all room-seat credentials.
4. Archive the allowed match summary if history storage is available.
5. Make all join/action routes return `ROOM_NOT_FOUND` or `ROOM_ABANDONED` immediately.
6. Acknowledge the final leaver.
7. After a short acknowledgement grace period, delete all Durable Object storage.

The Durable Object identity may still exist as an empty platform identity, but the room is deleted from the product perspective and has no persisted cards, players, credentials, or actions.

### 9.2 Inactivity Cleanup

- Disconnection alone does not immediately delete a room.
- Lobby with no connections expires after a documented inactivity window.
- Active match with no human connections expires after a longer recovery window.
- GameOver rooms expire after match history is archived and the rematch window closes.
- Cleanup uses Durable Object alarms and persisted deadlines, not in-memory timers.
- Cleanup is idempotent and safe under at-least-once alarm execution.

## 10. Ready State and Lobby

- Every human seat has a ready state in Lobby.
- Bots are implicitly ready.
- Joining, changing identity settings, or returning from rematch sets the human to not ready.
- Host may start only when at least two active seats exist and every connected human is ready.
- Start requests are idempotent and serialized.
- Lobby clearly states which players are ready without relying on color alone.
- Host may add/remove bots and remove human seats only before the match starts.
- Share link, QR code, and room-code copy are available in Lobby.

## 11. Host End Game

- Host may end the match during RoundActive, ResolvingRound, or while spectating after elimination.
- Selecting End Game opens a separate destructive confirmation.
- Confirmed end is an authoritative, idempotent `END_GAME` command.
- The result says `Game ended by <host>`.
- A host-ended game does not fabricate a winner unless a winner had already been determined.
- All clients receive the terminal state.
- Host may then offer rematch or close the room.

## 12. Rematch

- Rematch returns the same room code to Lobby with a new `matchId`.
- Previous match history is immutable and archived once.
- Human seats that did not explicitly leave remain seated and become not ready.
- Explicitly left humans do not silently return.
- Bots remain seated and may be removed before the next start.
- Card counts, elimination, claims, hands, winner, departure state, scheduled jobs, and action receipts reset for the new match.
- Seat identity and host identity remain where valid.
- Rematch requires a host command and is unavailable after the room is deleted.

## 13. Reactions

- Reactions are predefined, non-text social signals.
- Initial set: applause, laugh, shock, doubt, fire, and respect.
- Reactions are rate-limited per player and room.
- Reactions never change game state revision used for gameplay actions.
- They are ephemeral and need not be persisted in full match history.
- They include sender player ID and server timestamp.
- Muted sound/haptics preferences apply locally.
- Eliminated spectators may react; left players may not.

## 14. Profiles and Match History

### 14.1 Profile

- Stable account profile ID.
- Display name and optional avatar.
- Locale.
- Sound, haptic, motion, and visual-quality preferences.
- Aggregate statistics computed from archived matches.
- Email/provider identity remains private.

### 14.2 Match Summary

Store:

- Match ID and room code at play time.
- Start/end timestamps and end reason.
- Participant profile IDs where available, display names, bot markers, and final states.
- Winner when naturally determined.
- Round count.
- Per-round accepted claims, caller, claimant, truth result, penalty, eliminations, and departure events.
- Aggregate player statistics.

Do not permanently store:

- Raw PINs or reconnect tokens.
- Other players' unrevealed cards.
- Full WebSocket payload logs.
- Google tokens beyond what the selected authentication library securely requires.
- Card faces from abandoned, unresolved rounds.

## 15. Kinetic Cardroom Design System

### 15.1 Identity

- The visual language is neither traditional green casino, Exploding Kittens comic style, nor green neon.
- Base: midnight graphite and near-black.
- Information: crisp white and ice blue.
- Identity/action: ultraviolet and controlled pink.
- BullShit/danger: coral and true card red.
- Cards: high-contrast white with actual red hearts/diamonds and black clubs/spades.
- Borders remain precise and restrained, with a maximum normal card radius of 8px unless a circular control is semantically correct.

### 15.2 Deal-In Rail Entry

- Preserve the full-bleed launch image, responsive Three.js card scene, title, and supporting line as the dominant first-screen experience.
- Do not place create/join fields inside a large card or centered form panel.
- The resting entry state presents two compact glass controls at the bottom: `Create Table` and `Join Room`.
- Selecting a mode opens a low Deal-In Rail attached to the bottom edge. It shows exactly one input at a time and leaves the cinematic scene visible.
- Create sequence: player name, then four-digit PIN.
- Join sequence: six-character room code, player name, then four-digit PIN.
- The rail includes a back control, explicit step count, visual progress marks, mode switch, final action, compact connection feedback, and reconnect access when a stored seat exists.
- Valid shared room URLs open the Join rail at the name step with the room code prefilled; Back reveals the preserved code.
- Enter advances a valid intermediate step or submits the valid final step. Invalid steps cannot advance.
- The game PIN remains visually masked but must not use password-login field semantics or trigger browser password-save prompts.
- Values survive Back and Create/Join switching during the current entry session.
- The mobile rail is edge-to-edge, safe-area aware, and remains usable when the browser viewport or software keyboard changes height.
- Desktop uses the same interaction model in a bounded bottom console; it does not replace the experience with a separate desktop form.
- The Deal-In Rail is presentation only. Existing create, join, manual seat recovery, reconnect, credential storage, and server error behavior remain authoritative and unchanged.

### 15.3 Responsive Information Hierarchy

Always visible or one deliberate action away:

1. Whose move it is.
2. Current claim and claimant.
3. BullShit availability.
4. Player's private cards.
5. Recent claim sequence.
6. Connection state.
7. Total cards in the frozen round.

### 15.4 Mobile

- Stable top command bar with room, connection, card total, and menu/leave controls.
- Dynamic horizontal player rail with complete readable names and stable badge lanes.
- Protected center claim stage that cannot be covered by the hand dock.
- Claim timeline scrolls independently when needed and auto-focuses the newest accepted claim without hiding earlier claims.
- Hand dock fits one to five cards without unnecessary scrolling on supported widths; controlled scroll is allowed only when accessibility text scaling requires it.
- Make Claim and BullShit remain adjacent and stable.
- Bottom sheets respect safe areas, trap focus, and remain fully scrollable.

### 15.5 Desktop

- Use a balanced command-table layout rather than stretching mobile.
- Player rail, claim stage, and private hand receive explicit grid tracks.
- Long names receive measured width without truncating prematurely.
- The table does not require a decorative circular layout when it would reduce readability.
- Live and card-total status remain side-by-side when space permits.

### 15.6 Last Round

- Full-height mobile sheet and bounded desktop dialog.
- Sticky header and reliable close control.
- Truth result, caller, claimant, and narrative summary.
- Every revealed player hand is vertically reachable.
- Each hand row scrolls horizontally only when necessary.
- Proof cards are highlighted.
- Hearts and diamonds use actual card red.
- No redundant Truth/Penalty summary cards when the narrative already communicates them.

## 16. Three.js and Motion

### 16.1 Allowed Uses

- Full-bleed interactive entry background.
- Ambient table depth beneath the DOM game surface.
- Deal, claim, BullShit interruption, truth reveal, elimination, and winner transitions.
- Card-stack visualization for cards in play.

### 16.2 Prohibited Uses

- Three.js must not render authoritative controls, form fields, claim text, player names, or the only readable representation of a card.
- WebGL must not intercept touches intended for the UI.
- A scene must not run continuously while visually idle.
- Visual completion must never be required before the next authoritative state can apply.

### 16.3 Performance

- Lazy-load Three.js after the essential application UI.
- Cap pixel ratio and total drawing-buffer pixels.
- Render on demand when possible.
- Pause when the document is hidden.
- Dispose renderers, textures, materials, and geometries on unmount.
- Dynamically reduce particles, shadows, and antialiasing on constrained devices.
- Respect reduced motion and reduced data.
- Provide a CSS/image fallback with identical information.
- Run canvas-pixel and screenshot checks at mobile and desktop sizes.

## 17. Sound and Haptics

- Sound and haptics are optional and off until a user gesture permits playback.
- Independent toggles exist for music/ambience, effects, and haptics.
- Preferences persist locally and in signed-in profile settings.
- Sound cues: accepted claim, BullShit call, reveal, penalty, elimination, reconnect, and victory.
- Haptics are feature-detected and never required.
- Rapid bot claims coalesce audio so they do not create an overwhelming sequence.
- Background tabs do not play gameplay audio.

## 18. Sharing and PWA

- Lobby share URL pre-fills the room code but never includes a player ID, PIN, reconnect token, or account secret.
- Use Web Share when available, clipboard fallback otherwise.
- Generate QR locally from the safe room URL.
- Include an installable manifest, icons, theme colors, and service worker.
- Cache only versioned static application assets and a safe offline shell.
- Never cache authenticated API responses, private game views, WebSocket data, or OAuth callbacks.
- Offline UI states clearly state that live play requires a connection.
- New deployments use cache versioning so stale client bundles cannot keep incompatible protocols indefinitely.

## 19. Accessibility and Localization

- Meet WCAG AA contrast for text and interactive controls.
- Minimum pointer target is 44 by 44 CSS pixels.
- Keyboard access for every action.
- Focus traps in sheets/dialogs and focus restoration after close.
- Screen-reader announcements for accepted claims, BullShit calls, penalties, departures, and winner.
- Color is never the only status signal.
- Reduced motion disables or shortens all nonessential movement.
- Text supports browser zoom and increased font size without overlap.
- All user-facing strings use translation keys with English as the initial locale.
- Card ranks and suits remain semantically understandable when symbols are not announced correctly.

## 20. Security

- Durable Object remains authoritative for all room transitions.
- Every command is bound to an authenticated seat session.
- State revision, turn ID, claim window ID, match ID, and idempotency key are used according to command semantics.
- Use Web Crypto for high-entropy IDs and token hashing/signing.
- Compare verifiers in constant-time where practical.
- Apply CSRF protection to cookie-authenticated HTTP mutations.
- Validate Origin for WebSocket upgrades and authenticated routes.
- Add CSP, frame, content-type, referrer, and permissions-policy headers.
- Rate-limit joins, PIN failures, reactions, room creation, bot controls, and destructive commands.
- Sanitize and length-limit display names.
- Never use a production fallback secret.
- Redact secrets, PINs, OAuth data, private cards, and reconnect material from logs.
- Dependency versions are pinned and audited.

## 21. Durable Scheduling and WebSockets

- Use Durable Object WebSocket Hibernation APIs.
- Attach enough authenticated seat metadata to recover sessions after hibernation.
- Persist scheduled jobs and their expected match/state identifiers.
- Use one alarm for the earliest scheduled job and reschedule after processing.
- Jobs include bot action, auto-next-round reveal delay, room inactivity cleanup, and final deletion.
- Every job is idempotent and validates that its referenced state still exists.
- No per-second server loops or `setInterval`.
- Client animation timers are visual only.

## 22. Data Model

### 22.1 Room Player Additions

```ts
type ParticipationState = "Seated" | "Disconnected" | "Eliminated" | "Left";

type PlayerDeparture = {
  kind: "VOLUNTARY";
  at: number;
  matchId: string;
  requestId: string;
};
```

### 22.2 Round Additions

```ts
type RoundIdentity = {
  roundParticipantIds: string[];
  rotationAnchorPlayerId: string;
  finalDecisionAnchorPlayerId: string;
};
```

### 22.3 Scheduled Job

```ts
type ScheduledRoomJob = {
  id: string;
  kind: "BOT_ACTION" | "AUTO_NEXT_ROUND" | "CLEANUP" | "DELETE_ROOM";
  runAt: number;
  roomId: string;
  matchId?: string;
  expectedStateRevision?: number;
  payload?: Record<string, unknown>;
};
```

### 22.4 D1 Tables

- `user`
- `session`
- `account`
- `verification`
- `player_profile`
- `match_summary`
- `match_player`
- `round_summary`
- `profile_stats`

All D1 schema changes use reviewed migrations. Match archive writes use unique match IDs and upserts/idempotent constraints.

## 23. Protocol Events

Client commands:

- `SYNC_ROOM`
- `SET_READY`
- `ADD_BOT`
- `REMOVE_PLAYER`
- `START_GAME`
- `SUBMIT_CLAIM`
- `CALL_BULLSHIT`
- `LEAVE_GAME`
- `END_GAME`
- `REQUEST_REMATCH`
- `SEND_REACTION`
- `PING`

Server messages:

- `SESSION_ACCEPTED`
- `SESSION_REJECTED`
- `ROOM_UPDATED`
- `ACTION_REJECTED`
- `LEAVE_ACCEPTED`
- `REACTION_RECEIVED`
- `ROOM_DELETED`
- `PONG`

Every error uses a stable code plus latest safe view when one is available. Raw internal exceptions are not shown to players.

## 24. Testing Strategy

### 24.1 Frozen Rule Regression

- Preserve every passing V1 card, claim, reducer, resolution, view, shuffle, lifecycle, authority, session, route, and bot test.
- Add golden compatibility fixtures for representative V1 matches.

### 24.2 Leave Unit Tests

- Leave during own opening turn.
- Leave during own final-decision turn.
- Leave while another player acts.
- Starter leaves before and after making a claim.
- Current claimant leaves.
- Non-current player leaves.
- Eliminated spectator leaves.
- Host leaves while active.
- Host leaves while eliminated.
- Leave reduces active count to one and determines winner.
- Every human leaves and room abandons.
- Bots do not prevent abandonment.
- Duplicate request ID.
- Different request ID after already left.
- Old match leave after rematch.
- Left player cannot act.
- Left player cannot return active in the same match.
- Left cards remain in current round evaluation.
- Left cards are excluded next round.

### 24.3 Race Tests

- Leave versus claim in both commit orders.
- Leave versus BullShit in both commit orders.
- Leave versus final claim.
- Leave versus round resolution.
- Leave versus automatic next round.
- Two or more simultaneous leaves.
- Host leave versus End Game.
- Final human leave versus bot job.
- Acknowledgement lost after committed leave.
- Alarm delivered more than once.
- Room deletion retried.

### 24.4 Account and Security Tests

- Guest PIN validation and rate limiting.
- Cryptographic verifier does not store raw PIN.
- Google/account identity never appears in public room views.
- WebSocket origin and seat authorization.
- Session replacement and token rotation.
- CSRF rejection.
- OAuth callback and cookie attributes.
- History archive idempotency.

### 24.5 Browser Tests

- Entry, guest create/join, optional Google entry state.
- Lobby ready flow.
- Share URL, copy fallback, and QR.
- Full two-player game.
- Eight-player/bot claim timeline.
- Leave confirmation No preserves exact state.
- Leave Yes pending, success, and redirect.
- Rapid repeated Yes produces one transition.
- Network loss after leave send reconciles correctly.
- Browser refresh reconnects instead of leaving.
- Browser Back opens confirmation.
- Eliminated player leaves.
- Host transfer UI.
- Winner, End Game, rematch, and room deletion.
- Reactions and rate-limit feedback.
- PWA manifest/service-worker behavior.
- Keyboard and focus behavior.

### 24.6 Responsive and Visual Tests

Viewports:

- 360 by 640
- 390 by 844
- 430 by 932
- 768 by 1024
- 1024 by 768
- 1440 by 900
- 1920 by 1080

Verify:

- No overlaps or accidental page overflow.
- Longest supported player names remain inspectable.
- Ten-player rail remains usable.
- Five-card hand remains readable.
- Last-round review reaches the final player.
- Dialog close controls remain square and aligned.
- Canvas is nonblank when enabled and fallback works when disabled.
- Three.js does not intercept controls.
- Reduced-motion rendering is stable.

### 24.7 Quality Gates

- `npm run generate:types`
- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test`
- `npm run test:e2e`
- `npm run build`
- Deployment smoke tests

## 25. Implementation Phases

### Phase 1: Isolated Foundation

- Create V2 project and Wrangler configuration.
- Copy and lock the proven V1 engine/tests.
- Add generated Cloudflare types, lint, formatting, and CI scripts.
- Add protocol and state schema versioning.

### Phase 2: Lifecycle Reliability

- Add frozen round participants and split anchors.
- Add participation states.
- Implement authoritative/idempotent leave.
- Implement host transfer, abandonment, deletion, and cleanup alarms.
- Implement hibernating WebSockets and persisted job scheduling.

### Phase 3: Social Match Lifecycle

- Ready states.
- Host End Game.
- Rematch.
- Reactions.
- Match archive hooks.

### Phase 4: Identity and History

- D1 schema and migrations.
- Guest cryptographic identity hardening.
- Optional Google account routes.
- Profile, preferences, history, and stats.

### Phase 5: Kinetic Cardroom Client

- Componentized React application.
- Responsive entry, home, lobby, table, reveal, winner, and settings.
- Robust connection and pending-action state machines.
- Leave confirmation and recovery UX.
- Sharing, QR, sound, haptics, localization dictionaries, and PWA.
- Selective lazy-loaded Three.js scenes.

### Phase 6: Verification and Deployment

- Complete unit, integration, race, browser, accessibility, and visual tests.
- Provision V2-only Durable Object and D1 resources.
- Configure V2 secrets.
- Deploy only `bullshit-poker-v2`.
- Verify V1 URL remains unchanged and healthy.
- Verify V2 public URL and guest end-to-end game.

## 26. Definition of Done

V2 is complete when:

- V1 remains available at its existing URL and was not redeployed.
- V2 is available at `https://bullshit-poker-v2.every-day.workers.dev/`.
- Locked gameplay regression tests pass unchanged.
- Guest users can complete a match.
- Optional Google integration is secure and functional when credentials are configured.
- Leave is atomic, idempotent, race-tested, and cannot freeze a match.
- Left cards remain in the frozen current round and never enter a later round.
- Host transfer, winner determination, abandonment, and room deletion work.
- No human room data remains after deletion grace completes.
- Ready, End Game, rematch, reactions, sharing, history, PWA, sound/haptics, and responsive UI meet this specification.
- Three.js scenes are progressive, lazy, bounded, disposable, and never required for gameplay.
- Mobile and desktop browser suites pass.
- Security and accessibility checks pass.
- Free-tier resource usage is bounded and documented.
