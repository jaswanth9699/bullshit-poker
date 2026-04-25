# BullShit Poker Game Spec

Status: Draft for owner review before implementation

Source references inspected:

- BullShit Poker reference repository: https://github.com/Kan-Raju/BullShitPoker
- BullShit Poker main branch commit inspected: `119deea6e22753fe1bdf2576ff213c9b09cdcef0`
- BullShit Poker reference stack observed: React 18, Vite, Firebase Realtime Database, Framer Motion, lucide-react, react-confetti
- Exploding Kittens reference repository: https://github.com/ns-krishnakodali/exploding-kittens
- Exploding Kittens main branch commit inspected: `c5ce81d7f279b981cedc8b0de2a1e4ca0a0de14c`
- Exploding Kittens reference stack observed: React 19, Vite 7, Tailwind CSS 4, Firebase Realtime Database, Firebase Storage, Firebase Hosting, lucide-react, ESLint, Prettier

This document is intended to be fed to an AI coding agent as the implementation source of truth. The AI must not infer missing game rules. If a requirement is marked `Decision Needed`, implementation must pause and ask the owner.

## 1. Product Goal

Build a new, clean, mobile-first BullShit Poker web game inspired by the reference project, but not copied from it. The new game must have:

- Correct, deterministic card and claim logic.
- A clean state machine with no UI-driven game-rule side effects.
- A smooth real-time multiplayer experience.
- A mobile-first table UI that also works well on laptop and desktop.
- Strong test coverage around the card evaluator, claim ordering, round transitions, timers, reconnects, and race conditions.
- Server-authoritative hidden-card handling so players cannot receive other players' card faces before reveal.

The game should feel fast, polished, and trustworthy. The highest priority is rules correctness. UI polish must never hide or compensate for unclear logic.

## 2. Non-Goals

- Do not reuse the reference component as the new architecture.
- Do not keep all game logic in a single React component.
- Do not expose all players' hidden cards to every client before reveal.
- Do not allow client-side writes to directly mutate authoritative room state.
- Do not implement a marketing landing page as the primary screen.
- Do not add new rule variants unless explicitly requested.
- Do not begin code implementation until all `Decision Needed` items in Section 3 are resolved.

## 3. Decision Gate Before Implementation

These are the only open decisions. Everything else in this spec should be treated as defined.

### 3.1 Round End Rule

Locked: Option B, with final-claim outcome clarified.

Chosen rule:

- When play returns to the round's starting player and there is already a current claim, that starting player has a final-decision turn.
- On the final-decision turn, the starting player may either:
  - Call BullShit on the current claim.
  - Make a final legal higher claim.
- A final claim is immediately checked against all active round cards.
- No player gets a chance to call BullShit against the final claim.
- No further claim turn happens after the final claim.

Final-claim outcome:

- All active round cards are revealed either way.
- If the final claim is false, the final claimant gets +1 card.
- If the final claim is true, the round ends with no penalty.
- Next round starter still follows the locked Section 3.3 clockwise-rotation rule.

### 3.2 Who May Call BullShit

Locked: Option B.

Chosen rule:

- Any active player except the player who made the current claim may call BullShit before the next claim is server-accepted.
- The current turn player is not the only player who may call.
- The claimant may never call BullShit on their own current claim.
- Only one BullShit call can be accepted for a claim.
- A BullShit call and a next-claim submission can race; the server must accept exactly one winning action and reject the stale loser.
- A final claim under Section 3.1 does not open a BullShit response window.
- UI must show BullShit as a live available action for every active non-claimant while the claim response window is open.

### 3.3 Next Round Starting Player

Locked: Option B, with owner examples.

Chosen rule:

- The next round starter rotates clockwise from the previous round starter.
- This rule is independent of who received the penalty.
- This rule is independent of who was eliminated.
- Use the stable seat order from the game/lobby.
- Start searching one seat clockwise from the previous round starter's seat.
- Skip eliminated players.
- Skip players who voluntarily left mid-game.
- The first active player found becomes the next round starter.
- If only one active player remains, the game ends instead of starting a next round.

Owner examples:

- Seat order A, B, C. A started the round. B is eliminated. Next starter is C.
- Seat order A, B, C. A started the round. A is eliminated. Next starter is B.
- Seat order A, B, C. A started the round. C is eliminated. Next starter is B.
- Seat order A, B, C. A started the round. B voluntarily left mid-game. Next starter is C.

### 3.4 Flush Claim Ordering

Locked: Option B.

Chosen rule:

- For Flush claims only, lower declared high-card ranks are considered higher claims.
- Reason: lower declared high-card flushes are more restrictive because they require the declared card plus four lower same-suit cards.
- Example: King-high flush is a higher claim than Ace-high flush.
- Example: Queen-high flush is a higher claim than King-high flush.
- Suits are not ranked.
- Same hand type, same high-card rank, and different suit is not a higher claim.
- This reversed ordering applies only to regular Flush, not Straight, Straight Flush, or Royal Flush.

### 3.5 Bots In MVP

Locked: Option B.

Chosen rule:

- Include bots in MVP.
- Bots must be server-side only.
- Bots use conservative, probability-based play.
- Bots must follow the exact same legal action rules as humans.
- Bots must never inspect hidden cards beyond their own private hand.
- Bots may call BullShit out of turn under the locked Section 3.2 rule, as long as they are active non-claimants and the claim response window is open.
- Bots are primarily for solo testing, filling games, and smoother development QA.

### 3.6 Backend Preference

Locked: Cloudflare Pages + Cloudflare Workers + Cloudflare Durable Objects.

Chosen architecture:

- Frontend: React + TypeScript + Vite deployed as static assets on Cloudflare Pages or Cloudflare Workers static assets.
- Backend entrypoint: Cloudflare Worker for room creation, room-code lookup, identity/reconnect token issuance, API routing, and WebSocket upgrade routing.
- Room authority: one Cloudflare Durable Object per game room.
- Persistence: SQLite-backed Durable Object storage only.
- Realtime transport: WebSockets handled by the room Durable Object.
- Timer authority: Durable Object alarms for turn timeouts and room cleanup.
- Bots: server-side bot scheduling and bot actions run inside or through the authoritative room Durable Object.

Reason for this lock:

- The owner wants a personal game for the owner plus up to 7 friends, usually 5 to 6 games per day.
- This expected usage is comfortably inside Cloudflare Free limits if the implementation is not overly chatty.
- One Durable Object per room creates a single authoritative room brain, which naturally serializes BullShit calls, claim submissions, final claims, timeout resolution, bot actions, and stale-action rejection.
- Hidden cards can remain server-side and only be sent as private player payloads before reveal.
- No always-on personal server is required; the deployed link can be opened any day and the backend wakes when used.

Free-plan guardrails:

- The project must target the Cloudflare Workers Free plan by default.
- Do not require Workers Paid, Cloudflare Stream, Argo, Load Balancing, paid R2, paid D1, paid KV, or any paid Cloudflare add-on for MVP.
- Do not use key-value-backed Durable Objects because Workers Free supports SQLite-backed Durable Objects only.
- Do not depend on a credit-card-enabled paid upgrade path for normal personal use.
- If a Cloudflare free-tier limit is reached, the game should fail gracefully with a clear retry/limit message instead of hiding the failure.
- The README must document exactly which Cloudflare resources are used and which paid products must remain disabled for the free deployment target.

Free-tier implementation constraints:

- Use the Durable Object WebSocket Hibernation API where possible.
- Do not run per-second server loops.
- Do not use `setInterval` or frequent server wakeups for countdown display.
- Store turn deadline timestamps; clients animate countdown locally.
- Use Durable Object alarms for authoritative timeout handling.
- Persist only important events and snapshots: room creation, joins/leaves, game start, claims, BullShit calls, final claims, round results, penalties, eliminations, game over, and cleanup markers.
- Clean up stale rooms and old action logs after a documented retention window.
- Rate-limit abusive client actions per room and per player.
- Batch or coalesce public state broadcasts when multiple internal changes happen in one transition.

Alternatives considered but not selected:

- Supabase Free with Postgres/RLS, Edge Functions, and Realtime remains a viable fallback, but it is not the selected architecture.
- Convex Free is strong for TypeScript backend development, but it is not the selected architecture.
- Appwrite, Firebase, PartyKit, Rivet, Colyseus, and Nakama were considered. None should replace the locked Cloudflare Durable Object architecture without explicit owner approval.

### 3.7 Visual Style Adaptation

Locked: Option A and Option C hybrid.

Chosen visual direction:

- Premium tactile bluff-table UI.
- Use the Exploding Kittens reference as inspiration for bold physicality: thick borders, crisp offset shadows, tactile buttons, expressive action states, strong icon+text controls, and satisfying card motion.
- Use the calmer premium casino direction for hierarchy: cleaner spacing, darker bluff-table atmosphere, controlled color usage, readable typography, and less visual noise.
- The result should feel like a polished BullShit Poker table, not a reskinned Exploding Kittens clone and not a generic casino template.

Responsive layout decision:

- Mobile: use opponent carousel/top rail plus a clean center claim command zone.
- Tablet/laptop/desktop: use a richer circular poker-table layout only when there is enough space.
- Every screen size must preserve the same information hierarchy: current claim, claimant, timer, action availability, and recent claim timeline must never disappear or be covered.
- Last round cards always open in a dedicated review sheet/modal with grouped scrollable rows; they must never be squeezed into the table or clipped.

Non-negotiable UI principle:

- The center claim zone is sacred. Player cards, opponent seats, animations, modals, and action buttons must never cover the current claim, timer, claimant, BullShit availability, or recent claim history.

### 3.8 Player PIN And Room Join Pattern

Locked: Adopt the Exploding Kittens-style player PIN pattern, with safer internal identity handling.

Chosen rule:

- Every human player enters a display name and a 4-digit numeric player PIN.
- The PIN belongs to the player seat inside that room. It is not the room code.
- A human-friendly room code is still used to find/join a room.
- The room code should follow the Exploding Kittens reference pattern: short uppercase alphanumeric display code mapped to an internal room id. Default length: 6 characters.
- A player who refreshes or returns on another device may reclaim the same seat by entering the same room code, same normalized display name, and matching 4-digit PIN.
- A player must never be allowed to reclaim a seat by name alone.
- If the name exists and the PIN does not match, the join/reclaim attempt is rejected.
- If the name does not exist and the room is waiting, the player may join as a new player.
- If the game already started, new human players cannot join as active players unless a later spectator/fill-seat feature is explicitly approved.

Implementation requirements:

- User-facing behavior should feel similar to the Exploding Kittens reference: name input, masked 4-digit PIN input, create game, join existing game by code.
- Internally, do not copy the reference's name-as-database-key pattern. Use generated stable `playerId` values.
- Normalize display names for uniqueness checks, for example trim and uppercase.
- Store only a PIN hash or verifier in authoritative server/private state; do not store the raw PIN in public state.
- Issue a private reconnect/session token after successful join so normal refreshes can reconnect without retyping the PIN.
- The 4-digit PIN is acceptable for this personal friend-group game, but the server must still rate-limit repeated failed PIN attempts.
- Production logs and public action logs must never include raw PINs.

### 3.9 Title And Turn Timer

Locked.

Title:

- The exact displayed game title is `BullShit Poker`.
- Use this capitalization consistently in the app title, browser title, README, lobby, game screen, and deployment metadata.

Default turn timer:

- Default turn duration is 120 seconds.
- Store this as `turnDurationMs = 120000`.
- The timer is server-authoritative. Client countdowns are visual only.
- The Durable Object sets `turnExpiresAt = serverNow + turnDurationMs` when a turn starts or advances.

Timeout outcome:

- If the current player does not submit an accepted legal action before 120 seconds expires, the current player times out.
- Timeout immediately resolves the round.
- The timed-out player receives the penalty: their `cardCount` increases by 1.
- All active round cards are revealed in the round result.
- Eliminations are applied after the penalty. If the timed-out player's `cardCount > 5`, they are eliminated.
- If only one active player remains, the match ends.
- Otherwise, the next round starts using the locked clockwise starter-rotation rule from Section 3.3.
- Any claim, final claim, or BullShit call that reaches the server after timeout resolution is rejected as stale.

## 4. Reference Repo Observations

### 4.1 BullShit Poker Reference

The BullShit Poker reference repo provides a useful game concept and UI direction but should not be used as the code foundation.

Observed reference behavior:

- Supports room creation and joining by room PIN/code.
- Supports 2 to 10 players.
- Supports bot players.
- Starts every player with 1 card.
- Uses a standard 52-card deck.
- Players claim poker hands that exist across all active players' hidden cards.
- Players gain 1 card when they lose a challenge or time out.
- Players are eliminated when their `cardCount` becomes greater than 5.
- Last non-eliminated player wins.
- Shows a timer and reveals round results.
- Uses a rotating table layout with avatars around the table.

Issues and risk areas to avoid in the new build:

- Game logic, UI, timers, bot behavior, Firebase writes, and rendering are concentrated in one large component.
- The shared room state includes `allCards`, which means clients can receive information they should not know before reveal.
- Ace-low straight handling is unsafe. A 5-high straight must require Ace, 2, 3, 4, 5; it must not pass with only 2, 3, 4, 5.
- Flush claim semantics are unusual and need explicit owner approval.
- Two Pair and Full House comparison must compare both involved ranks, not only the first rank.
- Straight Flush and Royal Flush must not create duplicate/conflicting claim definitions.
- Round resolution when play returns to the starting player must be explicitly defined.
- Timer authority should not depend on a player's browser being open or being the host.

### 4.2 Exploding Kittens Reference

The Exploding Kittens repo is a stronger reference for application shape, visual identity, and documentation style than for hidden-information security. Use it as an implementation-quality and UI-style reference, but raise the correctness bar beyond it.

Observed strengths to carry forward:

- Clear top-level app flow: landing, lobby, and game arena are separate page components.
- Constants are centralized in `src/constants/index.js`.
- Firebase access is mostly grouped into service files under `src/services`.
- Local storage helpers are isolated in `src/utils/local-storage.js`.
- Lobby code maps a human-readable code to an internal lobby id.
- Landing flow asks every player for a display name and 4-digit PIN, then uses the PIN to let the same name re-enter the same lobby seat.
- The README documents database schema, room isolation, lifecycle fields, and deployment setup.
- UI has a strong, memorable identity with thick borders, offset shadows, high-contrast action colors, large touch targets, and lucide icons.
- The app includes `lint`, `format`, and `format:check` scripts.
- Game actions keep a `usedCardsDetails` stack, which is useful as an action log pattern.
- The app preloads card images before entering the game arena, reducing jarring image pop-in.
- Lobby host transfer exists when the current host leaves.

Observed weaknesses to improve, not copy:

- There are no automated tests in the inspected repository.
- The main game arena component is very large: `src/pages/game-arena/index.jsx` is 1593 lines.
- Game rules, UI event handlers, modal logic, subscriptions, image loading, and state mutation orchestration are all mixed in one component.
- The README says clients subscribe to their own deck, but the implementation subscribes to the entire lobby node and derives the player's cards from `lobbyDetails.players[playerName].deck`. That pattern can expose hidden player decks to every client.
- Player names are used as database keys, which makes identity, rename support, collision handling, and security rules harder.
- Randomness uses `Math.random()` directly in several places, making deterministic testing impossible.
- Some critical updates are transactional, but many multi-field game updates are plain Firebase `update` calls. The new game must make all turn-resolution mutations atomic.
- Some rule-specific rollback is handled with backup fields. The pattern is useful, but BullShit Poker should prefer explicit event-sourced round results and atomic state transitions over ad hoc backup fields.

Exploding Kittens standards to adopt:

- Keep the app split into screens/pages rather than one monolithic component.
- Keep constants, utilities, services, and UI components in clearly named modules.
- Maintain a detailed README/spec for schema and lifecycle.
- Use a human-friendly room code separate from the internal room id.
- Use the reference's player-facing name plus 4-digit PIN flow, but implement it with generated player ids and private PIN verifiers instead of name-keyed records.
- Use an action log for replay, debugging, and result display.
- Use bold, tactile UI controls with clear disabled states and strong action feedback.
- Use icon+text buttons for important actions.
- Preload critical card imagery or card-face assets before showing the game table.
- Provide visible lobby capacity slots.
- Provide copy-to-clipboard with fallback behavior.

Exploding Kittens patterns to explicitly avoid:

- Do not use player display names as stable database keys.
- Do not subscribe clients to a state node that contains other players' private cards.
- Do not put the main game arena in a 1000+ line component.
- Do not let UI handlers contain core rules.
- Do not rely on `Math.random()` inside pure game logic.
- Do not ship without tests.
- Do not depend on client honesty for hidden-information rules.

## 5. Core Game Concept

BullShit Poker is a bluffing and deduction card game.

Each active player has hidden cards. A claim says that a specific poker hand exists somewhere in the combined hidden cards of all active players. The claimant does not need to personally hold the claimed cards.

Players take turns raising the claim. A player who doubts the current claim may call BullShit. The claimed hand is checked against all active players' cards for that round. The wrong side takes a penalty card.

The number of cards a player must hold increases as they lose rounds. More cards means more information for that player, but it also brings them closer to elimination.

## 6. Player-Facing Rules

### 6.1 Players

- Minimum players to start: 2.
- Maximum players in a room: 10.
- Active players participate in turns and receive cards.
- Eliminated players remain visible as spectators but receive no cards and cannot act.
- The game ends when exactly 1 active player remains.

### 6.2 Cards

- One standard 52-card deck.
- Suits: Spades, Hearts, Diamonds, Clubs.
- Ranks from low to high: 2, 3, 4, 5, 6, 7, 8, 9, 10, Jack, Queen, King, Ace.
- Cards are unique within a round.
- At the start of each round, all active players are dealt a fresh set of cards equal to their current `cardCount`.
- Cards are not carried across rounds.
- Eliminated players have zero round cards.

### 6.3 Card Counts And Elimination

- Every player starts with `cardCount = 1`.
- Losing a resolution adds 1 to that player's `cardCount`.
- A player is eliminated immediately when their `cardCount > 5`.
- Active players can have card counts 1 through 5.
- A temporarily penalized card count of 6 means eliminated before the next deal.
- Because there are at most 10 active players and active players have at most 5 cards, the maximum active cards in a round is 50. This fits safely inside a 52-card deck.

### 6.4 Objective

- Be the last active player remaining.

## 7. Hand Claim Model

The game is not evaluating only the single best poker hand. It is evaluating whether a specific claimed hand pattern exists as a valid subset of the combined active players' cards.

Example: If a player claims "Pair of Queens", the claim is true if at least two Queens exist anywhere among all active players' cards.

### 7.1 Internal Rank Values

Use these internal values:

```text
2 = 2
3 = 3
4 = 4
5 = 5
6 = 6
7 = 7
8 = 8
9 = 9
10 = 10
J = 11
Q = 12
K = 13
A = 14
```

For Ace-low straights only, Ace may also be used as low in the sequence A, 2, 3, 4, 5. This does not change Ace's general rank value.

### 7.2 Hand Ranking Order

Low to high:

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

### 7.3 Claim Types

Each claim has:

- `type`: hand type.
- `primaryRank`: main rank when applicable.
- `secondaryRank`: second rank when applicable.
- `suit`: suit when applicable.
- `playerId`: claimant.
- `sequence`: monotonically increasing turn claim number.
- `createdAt`: server timestamp.

### 7.4 High Card

Claim shape:

```text
High Card, primaryRank
```

Truth condition:

- At least one card of `primaryRank` exists among active round cards.

Ordering:

- Higher `primaryRank` is a higher claim.

### 7.5 Pair

Claim shape:

```text
Pair, primaryRank
```

Truth condition:

- At least two cards of `primaryRank` exist among active round cards.

Ordering:

- Higher `primaryRank` is a higher claim.

### 7.6 Two Pair

Claim shape:

```text
Two Pair, highPairRank, lowPairRank
```

Validation:

- `highPairRank` and `lowPairRank` must be different.
- `highPairRank` must have a higher rank value than `lowPairRank`.

Truth condition:

- At least two cards of `highPairRank` exist.
- At least two cards of `lowPairRank` exist.

Ordering:

- Compare `highPairRank` first.
- If tied, compare `lowPairRank`.
- A claim is higher only if this lexicographic comparison is greater.

Example:

- Two Pair Kings and 3s beats Two Pair Queens and Jacks.
- Two Pair Kings and Queens beats Two Pair Kings and Jacks.
- Two Pair Kings and Jacks beats Two Pair Kings and 10s.
- Two Pair Kings and Aces must be normalized to Two Pair Aces and Kings. It beats Two Pair Kings and Queens because Aces are the higher pair.

Regression bug to prevent:

- Legal claim generation and UI filtering must not compare only `highPairRank`.
- If the current claim is Two Pair Kings and 10s, the next player must be allowed to claim Two Pair Kings and Jacks, Kings and Queens, or Aces and Kings.
- It is a bug if the UI only offers Two Pair Aces and 2s or other claims with a higher first pair while hiding valid same-first-pair, higher-second-pair claims.

### 7.7 Three of a Kind

Claim shape:

```text
Three of a Kind, primaryRank
```

Truth condition:

- At least three cards of `primaryRank` exist.

Ordering:

- Higher `primaryRank` is a higher claim.

### 7.8 Straight

Claim shape:

```text
Straight, highRank
```

Legal straight high ranks:

- 5, 6, 7, 8, 9, 10, Jack, Queen, King, Ace.

Truth condition:

- A 5-card sequence ending at `highRank` exists among active round cards.
- A 5-high straight requires Ace, 2, 3, 4, 5.
- An Ace-high straight requires 10, Jack, Queen, King, Ace.
- No wraparound straights are allowed. Queen, King, Ace, 2, 3 is not a straight.

Ordering:

- Higher `highRank` is a higher claim.

### 7.9 Flush

Claim shape:

```text
Flush, suit, highRank
```

Legal flush high ranks:

- 6, 7, 8, 9, 10, Jack, Queen, King, Ace.

Truth condition:

- At least one card of `suit` and `highRank` exists.
- At least four additional cards of the same `suit` with lower rank values exist.
- Ace is high only for flushes. It is not low in a flush.

Ordering:

- Lower `highRank` is a higher claim.
- This is intentionally different from standard poker ordering.
- The lowest legal flush claim, 6-high flush, is the highest regular Flush claim.
- Ace-high flush is the lowest regular Flush claim.
- Suits are not ranked.
- Same hand type and same high rank but different suit is not a higher claim.

Note:

- This uses "specific five-card subset exists" semantics, not "best possible flush" semantics.

### 7.10 Full House

Claim shape:

```text
Full House, tripsRank, pairRank
```

Validation:

- `tripsRank` and `pairRank` must be different.

Truth condition:

- At least three cards of `tripsRank` exist.
- At least two cards of `pairRank` exist.

Ordering:

- Compare `tripsRank` first.
- If tied, compare `pairRank`.

Example:

- Full House Queens over 2s beats Full House Jacks over Aces.
- Full House Queens over Kings beats Full House Queens over 10s.
- Full House Kings over Jacks beats Full House Kings over 10s.
- Full House Kings over Queens beats Full House Kings over Jacks.
- Full House Kings over Aces beats Full House Kings over Queens.

Regression bug to prevent:

- Legal claim generation and UI filtering must not compare only `tripsRank`.
- If the current claim is Full House Kings over 10s, the next player must be allowed to claim Full House Kings over Jacks, Kings over Queens, or Kings over Aces.
- It is a bug if the UI only offers Full House Aces over 2s or other claims with higher trips while hiding valid same-trips, higher-pair claims.

### 7.11 Four of a Kind

Claim shape:

```text
Four of a Kind, primaryRank
```

Truth condition:

- All four cards of `primaryRank` exist among active round cards.

Ordering:

- Higher `primaryRank` is a higher claim.

### 7.12 Straight Flush

Claim shape:

```text
Straight Flush, suit, highRank
```

Legal straight flush high ranks:

- 5, 6, 7, 8, 9, 10, Jack, Queen, King.

Truth condition:

- The exact 5-card straight sequence ending at `highRank` exists in `suit`.
- A 5-high straight flush requires suited Ace, 2, 3, 4, 5.
- Ace-high suited 10, Jack, Queen, King, Ace is represented as Royal Flush, not Straight Flush.

Ordering:

- Higher `highRank` is a higher claim.
- Suits are not ranked.

### 7.13 Royal Flush

Claim shape:

```text
Royal Flush, suit
```

Truth condition:

- 10, Jack, Queen, King, Ace of `suit` all exist among active round cards.

Ordering:

- Royal Flush is the highest hand class.
- Suits are not ranked.
- A Royal Flush of another suit is not higher than an existing Royal Flush claim.
- If the current claim is Royal Flush, there is no legal higher claim.

## 8. Claim Validity And Raising

### 8.1 Legal Claims

A claim is legal if:

- It has a valid hand type.
- Required ranks and suits are present in the claim object.
- Ranks are valid for that hand type.
- Two-rank hands use two different ranks.
- It is strictly higher than the previous claim, if a previous claim exists.
- The acting player is allowed to act.
- The game is in a turn state.
- The acting player is active and not eliminated.

### 8.2 Strictly Higher Comparison

Comparison order:

1. Compare hand class value.
2. If hand class differs, higher hand class wins.
3. If hand class is the same, use that hand type's tie-break rule.
4. If tie-break is equal, the claim is not higher.
5. Suits are never tie-breakers unless owner explicitly chooses suit ranking later.

### 8.3 No Legal Higher Claim

If no legal higher claim exists:

- The current turn player must call BullShit.
- UI must show no claim options and a prominent BullShit action.
- The server must reject any claim that is not strictly higher.
- If this happens on the starting player's final-decision turn, the starting player can only call BullShit because no valid final claim exists.

## 9. Round Flow

This section uses the locked Section 3 decisions.

### 9.1 Match Creation

1. Host creates a room.
2. Server generates a human-friendly room code.
3. Host enters display name and 4-digit player PIN.
4. Server normalizes the display name, creates a stable `playerId`, stores a PIN verifier privately, and issues a reconnect token.
5. Host joins as the first player.
6. Room enters `Lobby` state.

### 9.2 Lobby

Lobby supports:

- Name entry.
- 4-digit player PIN entry.
- Room code sharing.
- Player list.
- Host controls.
- Optional bot add/remove.
- Timer setting.
- Start game when at least 2 players are present.
- Bot add/remove controls for the host.
- Optional bot difficulty display if difficulty is configurable.

Lobby must prevent:

- Starting with fewer than 2 players.
- Joining above max player count.
- Duplicate normalized active names unless reclaim is attempted with the correct 4-digit PIN.
- Seat reclaim by name alone.
- Raw PIN exposure in public state or logs.
- Non-host starting the game.

### 9.3 Start Game

On start:

1. Server validates room state.
2. Server initializes all players:
   - `cardCount = 1`
   - `eliminated = false`
   - `roundCards = []`
3. Server sets a deterministic or cryptographically safe shuffle source.
4. Server chooses the first starting player: the active player in the lowest seat index, which is the host at seat 0 for a new room.
5. Server starts Round 1.

### 9.4 Start Round

On every new round:

1. Server creates and shuffles a new 52-card deck.
2. Server deals `cardCount` cards to each active player.
3. Server stores cards in private per-player state.
4. Server clears current claim and claim history.
5. Server sets `currentTurnPlayerId = startingPlayerId`.
6. Server sets `turnStartedAt`.
7. Server broadcasts redacted public room state.
8. Server privately sends each active player only their own cards.

### 9.4.1 Determine Next Round Starter

After any round resolution that does not end the game:

1. Read the previous round's `startingPlayerId`.
2. Read the stable clockwise seat order.
3. Begin with the seat immediately clockwise from the previous starter's seat.
4. Skip eliminated players and players who voluntarily left mid-game.
5. Choose the first active player found.
6. Set that player as `startingPlayerId` and `currentTurnPlayerId` for the next round.

This applies to all round endings:

- BullShit call.
- Timeout.
- False final claim, if owner confirms final claimant receives a penalty.
- True final claim, if owner confirms no penalty.

Examples:

- Seat order A, B, C. A started. B is eliminated. Next starter is C.
- Seat order A, B, C. A started. A is eliminated. Next starter is B.
- Seat order A, B, C. A started. C is eliminated. Next starter is B.

### 9.5 Player Turn

The current turn player may:

- Make a legal higher claim.
- Call BullShit if a current claim exists.
- If the current player is also the round's starting player and a current claim exists, this is a final-decision turn. On this turn the player may either call BullShit on the current claim or submit a final legal higher claim that resolves immediately.

Any active player may:

- Call BullShit on the current claim while its claim response window is open, as long as they are not the claimant.

Players may not:

- Pass.
- Make an equal or lower claim.
- Call BullShit when no current claim exists.
- Call BullShit on their own claim.
- Call BullShit after a later claim has already been server-accepted.
- Call BullShit after a final claim has been submitted.
- Act after timeout.
- Act while eliminated.

### 9.6 Submit Claim

On claim submission:

1. Server validates actor is current turn player.
2. Server validates claim shape.
3. Server validates claim is strictly higher than current claim.
4. Server appends claim to claim history.
5. Server sets claim as current claim.
6. Server closes the previous claim response window, if one existed.
7. If actor is the starting player and a current claim already existed before this submission, the claim is a final claim and server resolves it immediately under Section 9.7.
8. Otherwise, server opens a new claim response window for this claim.
9. Server advances turn clockwise to next active player.
10. Server resets timer.
11. Server broadcasts updated public state.

Race rule:

- Claim submission must include the latest `turnId`, `stateRevision`, and, when replacing an existing claim, the `claimWindowId` of the claim being replaced.
- If a BullShit call already resolved that `claimWindowId`, the server rejects the claim submission as stale.
- If the claim submission is accepted first, all BullShit calls against the previous `claimWindowId` are rejected as stale.

### 9.7 Final Claim Resolution

On final claim submission:

1. Server validates actor is the current turn player.
2. Server validates actor is the round's starting player.
3. Server validates there was already a current claim before this claim.
4. Server validates final claim is strictly higher than the previous current claim.
5. Server closes the previous claim response window atomically.
6. Server does not open a response window for the final claim.
7. Server freezes the round.
8. Server evaluates the final claim against all active players' private round cards.
9. Server reveals all active round cards in the round result.
10. Server applies the locked final-claim outcome rules.
11. If one active player remains, server ends match.
12. Otherwise, server starts next round.

Race rule:

- If any active non-claimant calls BullShit on the previous claim before the final claim is accepted, that BullShit call wins and the final claim is rejected as stale.
- If the final claim is accepted first, all later BullShit calls against the previous claim are rejected as stale.

Final-claim outcome rule:

- If the final claim is false, the final claimant receives the penalty.
- If the final claim is true, the round ends with no penalty.
- All active round cards are revealed either way.
- Next-round starter follows Section 9.4.1.

### 9.8 Call BullShit

On BullShit call:

1. Server validates there is an open claim response window.
2. Server validates actor is active and not eliminated.
3. Server validates actor is not the current claimant.
4. Server validates the action references the latest `claimWindowId`.
5. Server atomically closes the claim response window.
6. Server freezes the round.
7. Server evaluates the current claim against all active players' private round cards.
8. If claim is false:
   - Claimant receives penalty.
9. If claim is true:
   - Caller receives penalty.
10. Server reveals all active round cards in the round result.
11. Server applies elimination if penalty player's `cardCount > 5`.
12. If one active player remains, server ends match.
13. Otherwise, server starts next round.

Race rule:

- If multiple players call BullShit on the same `claimWindowId`, exactly one call is accepted.
- The accepted call is whichever call the server commits first in the authoritative atomic transition.
- Rejected callers receive a stale action response and must resync to latest room state.
- A BullShit call can race against a next claim, a final claim, or a timeout; exactly one transition may close the active claim/turn state.

### 9.9 Timeout

On timeout:

1. Server-authoritative 120-second timer expires for the current player.
2. Server rejects any later claim, final claim, or BullShit call for the expired `turnId` as stale.
3. Current player receives the timeout penalty.
4. Current player's `cardCount` increases by 1.
5. Round ends immediately.
6. Server reveals all active round cards in the round result.
7. Server records timeout reason and penalty player in the round result.
8. Server applies elimination if the timed-out player's `cardCount > 5`.
9. If one active player remains, server ends match.
10. Otherwise, server starts next round using Section 3.3 starter rotation.

Timer authority must be server-side. Client-side timers are visual only.

### 9.10 Match End

The match ends when exactly one active player remains.

Final state includes:

- Winner.
- Final player standings.
- Round count.
- Optional match log.
- Option to create rematch with same room members.

## 10. State Machine

### 10.1 Room States

```text
Lobby
Starting
RoundActive
ResolvingRound
GameOver
Closed
```

### 10.2 Events

```text
CREATE_ROOM
JOIN_ROOM
RECONNECT_PLAYER
LEAVE_ROOM
ADD_BOT
REMOVE_BOT
START_GAME
START_ROUND
SUBMIT_CLAIM
CALL_BULLSHIT
TURN_TIMEOUT
RESOLVE_ROUND
ELIMINATE_PLAYER
END_GAME
REMATCH
CLOSE_ROOM
```

### 10.3 Event Rules

- Every event must be validated against current state.
- Invalid events must return structured errors and must not partially mutate state.
- Round resolution must be atomic.
- A turn can be resolved only once.
- Claim submission and BullShit calls must use server-side sequence numbers, `turnId`, `claimWindowId`, and `stateRevision` to reject stale actions.
- Every claim except a final claim opens exactly one claim response window.
- A claim response window can be closed only once.
- A claim response window closes when a BullShit call is accepted, a higher next claim is accepted, a final claim is accepted, or timeout resolves the round.
- If multiple actions target the same open claim response window, the authoritative server transaction decides the winner and rejects all stale losers.
- Client arrival order is not trusted. Only the order of successful server commits matters.
- The server must make the close-window transition and the resulting state update in one atomic operation.

### 10.4 Core Invariants

The implementation must enforce these invariants:

- A room has exactly one state at a time.
- A non-started room has no active round cards.
- A round has a unique deck instance.
- No card can be held by more than one active player in the same round.
- Active players have `cardCount` between 1 and 5.
- Eliminated players have no round cards.
- At most one current claim exists.
- Claim history is ordered by sequence.
- Every claim after the first is strictly higher than the claim before it.
- Only active players can act.
- Only the current turn player can submit claims.
- Any active non-claimant can call BullShit while a claim response window is open.
- The current claimant can never call BullShit on their own claim.
- The current turn player is always active.
- At most one claim response window is open.
- A final claim has no response window.
- A resolved or replaced claim response window can never be reopened.
- The server never sends hidden cards of player A to player B before reveal.
- A resolved round has exactly one penalty player except when a true final claim ends the round with no penalty.
- A game over state has exactly one winner.

## 11. Data Model

Use TypeScript types. The exact code can differ, but the data model must preserve these concepts.

### 11.1 Card

```ts
type Suit = "S" | "H" | "D" | "C";
type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

type Card = {
  id: string; // example: "AS"
  rank: Rank;
  suit: Suit;
};
```

### 11.2 Player

```ts
type PlayerPublic = {
  id: string;
  name: string;
  normalizedName: string;
  seatIndex: number;
  avatarKey: string;
  cardCount: number;
  eliminated: boolean;
  connected: boolean;
  isBot: boolean;
};

type PlayerPrivate = {
  playerId: string;
  pinVerifier: string;
  reconnectTokenHash: string;
  roundCards: Card[];
};
```

Player identity rules:

- `name` is the display value.
- `normalizedName` is used for case-insensitive uniqueness inside a room.
- `pinVerifier` must not be sent in public state.
- `reconnectTokenHash` must not be sent in public state.
- Clients receive the raw reconnect token only once, after successful create/join/reclaim.

### 11.3 Claim

```ts
type HandType =
  | "HIGH_CARD"
  | "PAIR"
  | "TWO_PAIR"
  | "THREE_OF_A_KIND"
  | "STRAIGHT"
  | "FLUSH"
  | "FULL_HOUSE"
  | "FOUR_OF_A_KIND"
  | "STRAIGHT_FLUSH"
  | "ROYAL_FLUSH";

type Claim = {
  id: string;
  sequence: number;
  playerId: string;
  handType: HandType;
  primaryRank?: Rank;
  secondaryRank?: Rank;
  suit?: Suit;
  createdAt: number;
};
```

### 11.4 Claim Response Window

Each non-final claim opens a response window that allows active non-claimants to call BullShit. This is the core race-control primitive for Option B in Section 3.2.

```ts
type ClaimResponseWindow = {
  id: string;
  claimId: string;
  roundNumber: number;
  openedByClaimSequence: number;
  status: "OPEN" | "CLOSED";
  openedAt: number;
  closedAt?: number;
  closedBy?:
    | "BULLSHIT_CALL"
    | "NEXT_CLAIM"
    | "FINAL_CLAIM"
    | "TIMEOUT"
    | "ROUND_CANCELLED";
};
```

### 11.5 Public Room State

```ts
type PublicRoomState = {
  roomId: string;
  code: string;
  state: "Lobby" | "Starting" | "RoundActive" | "ResolvingRound" | "GameOver" | "Closed";
  stateRevision: number;
  hostPlayerId: string;
  players: PlayerPublic[];
  roundNumber: number;
  startingPlayerId?: string;
  currentTurnPlayerId?: string;
  currentTurnId?: string;
  currentClaim?: Claim;
  activeClaimWindow?: ClaimResponseWindow;
  claimHistory: Claim[];
  actionLog: PublicActionLogEntry[];
  turnStartedAt?: number;
  turnExpiresAt?: number;
  turnDurationMs: number; // default 120000
  lastRoundResult?: RoundResult;
  winnerPlayerId?: string;
};
```

Timer state rules:

- Default `turnDurationMs` is `120000`.
- `turnStartedAt` and `turnExpiresAt` are server timestamps.
- Clients may animate countdown locally from these timestamps, but timeout authority belongs to the Durable Object alarm/room authority.

Room code rules:

- `code` is the human-friendly join code.
- `code` should be 6 uppercase alphanumeric characters by default.
- `code` maps to an internal Durable Object id through the Cloudflare Worker.
- The room code is not a player PIN and does not prove player identity.
- Room code generation must retry on collision.

### 11.6 Public Action Log

Inspired by the Exploding Kittens `usedCardsDetails` stack, BullShit Poker should keep a public action log for replay, debugging, and UI history. It must never contain hidden card faces before reveal.

```ts
type PublicActionLogEntry = {
  id: string;
  roundNumber: number;
  sequence: number;
  type:
    | "ROOM_CREATED"
    | "PLAYER_JOINED"
    | "PLAYER_LEFT"
    | "GAME_STARTED"
    | "ROUND_STARTED"
    | "CLAIM_SUBMITTED"
    | "FINAL_CLAIM_SUBMITTED"
    | "BULLSHIT_CALLED"
    | "ROUND_RESOLVED"
    | "PLAYER_PENALIZED"
    | "PLAYER_ELIMINATED"
    | "GAME_ENDED";
  actorPlayerId?: string;
  targetPlayerId?: string;
  claimId?: string;
  messageKey: string;
  createdAt: number;
};
```

### 11.7 Private Player State

```ts
type PrivatePlayerState = {
  roomId: string;
  playerId: string;
  pinVerifier: string;
  reconnectTokenHash: string;
  roundCards: Card[];
};
```

### 11.8 Round Result

```ts
type RoundResult = {
  id: string;
  roundNumber: number;
  reason: "BULLSHIT_CALL" | "FINAL_CLAIM" | "TIMEOUT" | "NO_LEGAL_CLAIM";
  claim?: Claim;
  finalClaimId?: string;
  callerPlayerId?: string;
  claimantPlayerId?: string;
  claimWasTrue?: boolean;
  penaltyPlayerId?: string;
  noPenaltyReason?: "TRUE_FINAL_CLAIM";
  acceptedBullShitCallActionId?: string;
  rejectedBullShitCallActionIds?: string[];
  proofCardIds?: string[];
  revealedHands: Array<{
    playerId: string;
    cards: Card[];
  }>;
  eliminatedPlayerIds: string[];
  nextStartingPlayerId?: string;
  narrativeKey: string;
  createdAt: number;
};
```

Round result requirements:

- `callerPlayerId` is required when `reason` is `BULLSHIT_CALL`.
- `claimantPlayerId` is required when `claim` exists.
- `acceptedBullShitCallActionId` records the server-accepted BullShit call when there was a call race.
- `rejectedBullShitCallActionIds` may be included for debugging and UI stale-action explanation, but must not expose private cards.
- `proofCardIds` contains the exact revealed cards that satisfy a true claim when the evaluator can produce proof. The UI must use this to highlight why the claim was true.
- `penaltyPlayerId` is required when a penalty exists.
- If a true final claim ends the round with no penalty, `penaltyPlayerId` is omitted and `noPenaltyReason` must be `TRUE_FINAL_CLAIM`.
- `narrativeKey` drives a concise UI sentence such as `PLAYER_CALLED_BULLSHIT_AND_CLAIM_WAS_TRUE`, `FINAL_CLAIM_FALSE`, or `PLAYER_TIMED_OUT`.

## 12. Game Engine Architecture

### 12.0 Coding Standard Target

The new BullShit Poker implementation should follow the clean application organization seen in the Exploding Kittens repo, but with stricter typing, stronger test coverage, and stronger hidden-information security.

Baseline standards:

- Use TypeScript for all source modules.
- Use React with Vite for the frontend.
- Use Tailwind CSS for the main design system if the frontend remains Vite/React.
- Use lucide-react for icons.
- Include ESLint and Prettier from the start.
- Add `lint`, `format`, `format:check`, `typecheck`, `test`, `test:watch`, `test:e2e`, and `build` scripts.
- Keep game logic independent of React.
- Keep service modules thin and typed.
- Keep page components small enough to review. A page component over 300 lines must be split unless there is a documented reason.
- Keep reusable UI components under a `components` or `client/common` area.
- Keep constants in dedicated modules; do not scatter display strings and magic numbers through components.
- Use explicit error codes instead of boolean-only service results.
- Use dependency injection for time, random number generation, and persistence when testing engine code.
- Use schema validation at network boundaries.

Required code quality bar beyond both references:

- No untested card/claim evaluator.
- No client-authoritative hidden cards.
- No direct mutation of shared room state from arbitrary client code.
- No large all-purpose component equivalent to the 1593-line Exploding Kittens game arena.
- No random shuffle that cannot be tested deterministically.
- No room state shape that contradicts the documented schema.
- No "best effort" race handling for turn actions.

### 12.1 Required Separation

The implementation must separate:

- Pure card/claim logic.
- Pure state transition logic.
- Backend transport logic.
- Frontend rendering.
- UI animation.
- Bot strategy.
- Bot scheduling.

No React component should contain authoritative game rules.

### 12.2 Recommended Modules

```text
src/shared/cards/
  cardTypes.ts
  deck.ts
  shuffle.ts
  rankValues.ts

src/shared/claims/
  claimTypes.ts
  legalClaims.ts
  compareClaims.ts
  evaluateClaim.ts
  formatClaim.ts

src/shared/game/
  gameTypes.ts
  stateMachine.ts
  roundResolution.ts
  seatOrder.ts
  errors.ts

src/worker/
  worker.ts
  routes.ts
  roomCodeService.ts
  authTokenService.ts
  protocol.ts

src/durable-objects/
  roomDurableObject.ts
  roomStorage.ts
  roomSessionRegistry.ts
  roomBroadcast.ts
  roomAlarms.ts
  botService.ts
  cleanupService.ts

src/client/
  appShell/
  landing/
  lobby/
  gameTable/
  playerSeats/
  claimPicker/
  roundResult/
  actionLog/
  modals/
  common/
```

The Cloudflare Worker and Durable Object modules must stay thin around the shared engine. Authoritative rule decisions should call typed shared state-machine functions, then commit and broadcast the resulting state transition.

### 12.3 Pure Functions Required

At minimum:

```text
createDeck(): Card[]
shuffleDeck(deck, rng): Card[]
dealRound(players, deck): DealResult
getLegalClaimsAfter(previousClaim): ClaimTemplate[]
normalizeClaimShape(claim): Claim
compareClaims(a, b): -1 | 0 | 1
isClaimStrictlyHigher(next, previous): boolean
evaluateClaim(claim, cards): boolean
normalizeDisplayName(name): string
validatePlayerPin(pin): boolean
advanceToNextActivePlayer(players, currentPlayerId): playerId
determineNextRoundStarter(players, previousStartingPlayerId): playerId
applyPenalty(gameState, penaltyPlayerId): gameState
canCallBullshit(gameState, callerPlayerId, claimWindowId): boolean
resolveBullshitCall(gameState, callerPlayerId): ResolutionResult
resolveFinalClaim(gameState, finalClaim): ResolutionResult
resolveTimeout(gameState): ResolutionResult
```

Pure functions must not read time, random values, network, local storage, or process state directly. Those values must be injected.

## 13. Multiplayer And Security

### 13.1 Server Authority

The server is authoritative for:

- Room creation.
- Player identity tokens.
- Seat order.
- Deck shuffle.
- Dealing.
- Current turn.
- Timer expiration.
- Claim validation.
- Round resolution.
- Eliminations.
- Winner selection.
- Bot scheduling and bot action submission.

Clients are authoritative only for:

- Local visual preferences.
- Input attempts.
- Display state.

### 13.2 Hidden Cards

Before reveal:

- A player receives only their own round cards.
- Other players' cards are represented only as card backs/counts.
- Public state must not include `allCards`.
- Public state must not include deck order.
- Public state must not include private cards in logs, errors, or analytics.

Required state partition:

```text
Cloudflare Worker
  roomCodes/{code} -> durableObjectId

Room Durable Object persisted state
  publicRoomState
  privatePlayerStates/{playerId}
  privatePlayerCredentials/{playerId}
  privateServerState
  actionLog
  cleanupMetadata

Room Durable Object outbound payloads
  PublicRoomView -> all connected room clients
  PrivatePlayerView -> exactly one authenticated player connection
  RevealedRoundResultView -> all clients only after round resolution
```

The privacy boundary cannot differ:

- Public room broadcasts include only `PublicRoomView`.
- Player connections receive only their own `PrivatePlayerView`.
- Other players' private card faces are inaccessible before reveal.
- Round-result reveals are copied into public state only after resolution.

For Cloudflare Durable Objects:

- The Durable Object may store the full authoritative room state, including all hidden cards.
- The Durable Object must never broadcast full authoritative room state before reveal.
- All client messages are action requests, not direct state mutations.
- Every action request is authenticated with a player id and reconnect/session token.
- Join/reclaim requests authenticate an existing human seat with normalized display name plus matching 4-digit PIN.
- After join/reclaim, normal WebSocket actions authenticate with the server-issued reconnect/session token rather than repeatedly sending the PIN.
- The Durable Object validates and applies actions atomically through the shared state machine.
- The implementation must not include a debug endpoint, log entry, analytics event, or error response that exposes private cards before reveal.
- The implementation must not include raw PINs in public state, action logs, analytics, or production logs.

After reveal:

- Round result may include all active players' round cards.
- Revealed cards belong to the round result and should not be confused with next round cards.

### 13.3 Reconnection

Each player should have:

- A stable `playerId`.
- A private reconnect token stored locally.
- A 4-digit numeric player PIN for manual seat reclaim.
- A display name.
- A normalized display name used for uniqueness checks.

Reconnection behavior:

- If a connected player refreshes, they rejoin their seat using reconnect token.
- If the same normalized name joins without a valid reconnect token, the server may reclaim the seat only when the submitted 4-digit PIN matches the stored player PIN verifier.
- If the same normalized name joins with the wrong PIN, reject the attempt with `PIN_MISMATCH`.
- A player must never reclaim a seat by name alone.
- If a disconnected player's turn arrives, their timer still runs.
- If they time out, normal timeout penalty applies.

### 13.4 Race Conditions

Server must reject:

- Duplicate claim submits for same turn sequence.
- Claim after timer expiration.
- BullShit call after another action already advanced the turn.
- Stale client state actions.
- Actions from eliminated players.
- Actions from spectators.
- Host-only actions from non-host players.
- BullShit calls from the current claimant.
- BullShit calls against a closed `claimWindowId`.
- BullShit calls against a claim that has already been replaced by a higher claim.
- BullShit calls after a final claim has been accepted.
- Claim submissions that try to replace a claim window already closed by a BullShit call.

Use turn IDs:

```text
turnId = roomId + roundNumber + currentTurnPlayerId + turnSequence
```

Use claim window IDs:

```text
claimWindowId = roomId + roundNumber + claimSequence + claimId
```

Every client action must include:

- Latest `stateRevision`.
- Latest `turnId` for claim and timeout-sensitive turn actions.
- Latest `claimWindowId` for BullShit calls and for claim submissions that replace an existing claim.
- Actor's authenticated player id.

Atomic race scenarios:

- Call vs call: the first accepted server transaction closes the claim window; all other calls fail with `STALE_CLAIM_WINDOW`.
- Call vs next claim: if the call closes the window first, the next claim fails as stale; if the next claim closes/replaces the window first, the call fails as stale.
- Call vs final claim: if the call closes the previous window first, final claim fails as stale; if final claim closes the previous window first, the call fails as stale and no new window opens.
- Call vs timeout: if timeout resolves first, call fails with `TURN_EXPIRED` or `ROUND_ALREADY_RESOLVED`; if the call resolves first before expiry, timeout fails because the round is no longer active.
- Next claim vs timeout: claim is accepted only if server validation occurs before turn expiry and commits first; otherwise timeout wins.
- Duplicate request retry: idempotency keys should prevent an accepted action from applying twice.
- If a player leaves mid-game during an open claim window, the server must close or invalidate any pending action from that player and exclude them from future starter rotation.

Required action request shape:

```ts
type ClientActionEnvelope<TPayload> = {
  requestId: string;
  roomId: string;
  playerId: string;
  stateRevision: number;
  turnId?: string;
  claimWindowId?: string;
  payload: TPayload;
};
```

Server action result:

```ts
type ActionResult =
  | { ok: true; newStateRevision: number }
  | { ok: false; code: ServerErrorCode; latestStateRevision: number };
```

## 14. Bot Design

Bots are included in MVP.

Required bot principles:

- Bots run on the server only.
- Bots receive only their own cards plus public state.
- Bots must not inspect hidden cards beyond their own private hand.
- Bot actions must use the same validation path as human actions.
- Bot action requests must include the same `turnId`, `claimWindowId`, `stateRevision`, and idempotency keys as human actions.
- Bot delay should feel human but not slow.
- Bot decision randomness must be injectable for tests.
- Bot strategy must be deterministic when seeded.
- Bots must be conservative by default. They should avoid reckless escalation and avoid calling BullShit on every low-probability claim.
- Bots must be bounded. No unbounded Monte Carlo loops, no long-running recursive searches, and no client-side bot thinking.

MVP bot lobby behavior:

- Host can add bots in lobby.
- Host can remove bots in lobby before game start.
- Bots count toward the 2-player minimum and 10-player maximum.
- Bots have stable player ids, names, avatars, seat indexes, and `isBot = true`.
- Bots cannot be added after the game starts unless owner later approves a fill-empty-seat feature.
- Bot difficulty defaults to `Normal`.
- Optional bot difficulty selector may be added if cheap, but not at the expense of game correctness.

MVP bot strategy:

- Estimate probability of a claim being true from:
  - Bot's private cards.
  - Public card counts for active players.
  - Number of unknown cards in the round.
  - Remaining possible deck composition after excluding bot's private cards.
- Probability estimator must not use other players' private cards.
- Use bounded sampling for complex hands and exact counting where simple.
- Default maximum samples per decision: 150.
- If no legal higher claim exists and the bot is allowed to call BullShit, call BullShit.
- If it is the bot's claim turn and legal higher claims exist, choose a claim using a conservative score:
  - Prefer claims with higher estimated truth probability.
  - Penalize large jumps in hand class.
  - Penalize claims close to impossible from bot's perspective.
  - Add small seeded randomness so bots do not feel identical.
- If it is a bot's final-decision turn under Section 3.1:
  - Evaluate whether to call BullShit on the current claim.
  - Otherwise choose a final higher claim only if it clears the final-claim confidence threshold.
  - If no legal final claim clears threshold, call BullShit.
- If a claim response window is open and the bot is an active non-claimant:
  - Schedule a possible BullShit decision after a short delay.
  - Recheck `claimWindowId` before acting.
  - Submit the call only if the window is still open and the bot's threshold says to challenge.

Default thresholds:

- Call BullShit when estimated truth probability is below `0.30`.
- On final-decision turn, make a final claim only if estimated truth probability for that final claim is at least `0.42`.
- When choosing a normal claim, prefer candidate claims with estimated truth probability at least `0.38`.
- If all legal higher claims are below `0.20` and the bot can call BullShit, call BullShit instead.
- Add risk adjustment based on bot card count:
  - `cardCount` 1-2: slightly bolder.
  - `cardCount` 3: normal.
  - `cardCount` 4-5: more conservative about false final claims and reckless raises.

Bot timing:

- Bot claim-turn action delay: 900ms to 1800ms.
- Bot out-of-turn BullShit consideration delay: 600ms to 1600ms.
- Bot final-decision delay: 1000ms to 2200ms.
- Delay randomness must be seeded/injectable.
- If a human or another bot closes the relevant claim window before the delay fires, the bot action is cancelled.

Bot difficulty settings:

- Casual: higher randomness, weaker probability estimates.
- Normal: balanced.
- Sharp: lower randomness, stronger challenge thresholds.

MVP should implement `Normal` at minimum. `Casual` and `Sharp` can be implemented if the architecture already supports difficulty as a small configuration object.

Bot race handling:

- Bots can race humans and other bots for BullShit calls under Section 3.2.
- Bot calls use the same `claimWindowId` close-window transaction as human calls.
- A stale bot action must be silently discarded or logged as stale; it must not show as an error to players.
- Bot action scheduler must cancel pending actions on:
  - Claim window close.
  - New claim accepted.
  - Final claim accepted.
  - Timeout.
  - Round resolved.
  - Bot eliminated or removed.

Bot observability:

- In development, bot decisions may log concise debug metadata: selected action, estimated probability, threshold, candidate count.
- Production logs must not expose hidden cards beyond the bot's own private hand.
- Bot debug logging must be easy to disable.

## 15. UI/UX Design

### 15.1 Design Principles

- Mobile is primary.
- The game screen is the first-class experience, not a marketing page.
- Use direct manipulation and clear action states.
- Keep claim creation fast with large touch targets.
- Every player should always know:
  - Whose turn it is.
  - What the current claim is.
  - How much time remains.
  - What actions are available.
  - Their own cards.
  - Their danger level.
- Avoid visible tutorial clutter during normal play.
- Use a dedicated rules/help surface, not persistent instructional text everywhere.

### 15.2 Visual Direction

Locked visual language:

- Premium tactile bluff table.
- Thick black borders and deliberate offset shadows inspired by the Exploding Kittens reference, but applied with restraint.
- Dark green or deep teal felt as the table anchor.
- Charcoal, ink, cream, off-white, and muted gold for a calmer premium casino structure.
- Red accent only for BullShit, danger, penalties, elimination, and destructive moments.
- Blue/cobalt or green accent for safe primary actions such as Make Claim.
- Gold/yellow accent for current turn, room code, winner, and high-confidence status highlights.
- Off-white cards with crisp suit/rank contrast.
- Strong icon+text action buttons using lucide icons.
- Uppercase display labels can be used for high-emphasis headings and chips, but body/help text must stay readable.
- Tactile hover/press states should use small transforms and shadow changes.
- Animation should feel rich and physical, but it must clarify state rather than delay play.

Avoid:

- A one-note all-green, all-brown, all-purple, or red-dominant palette.
- Heavy decorative blobs/orbs.
- Nested card panels.
- Marketing-page hero styling as the primary game surface.
- Importing the Exploding Kittens theme literally. No cat/feline/explosion wording, no red/yellow chaos as the whole brand treatment, and no motifs that imply the other game.

Poker-specific style translation:

- Landing/create screen: bold title, compact create/join panel, room-code entry, no marketing hero.
- Lobby: capacity slots like the reference, but styled as poker seats/chips.
- Mobile game: top opponent rail, protected center claim command zone, fixed bottom hand/action dock.
- Tablet/desktop game: circular poker table layout only if claims, hand, seats, and controls have protected non-overlapping zones.
- Claim history: compact "bluff trail" timeline inspired by `usedCardsDetails`.
- Penalty track: represent 1 through 5 danger as poker chips/cards, with strong red treatment near elimination.
- Round reveal: dramatic card flip/reveal motion with reduced-motion fallback.

### 15.3 Mobile Layout

Target viewports:

- 360 x 640
- 390 x 844
- 414 x 896
- 430 x 932

Mobile game layout:

- Full-screen game surface with no marketing content.
- Compact sticky top bar:
  - Room code.
  - Timer/deadline.
  - Connection state.
  - Menu/rules/settings icon.
- Opponent rail:
  - Horizontal carousel/top rail for all opponents.
  - Shows player avatar/initial, display name, card count, danger level, bot/human marker, disconnected state, eliminated state, and active turn marker.
  - Supports 2 to 10 players without cramping the center claim zone.
  - The rail can scroll horizontally. This is allowed because it is an intentional carousel, not accidental page overflow.
- Center claim command zone:
  - Current claim.
  - Claimant.
  - Whose turn it is.
  - Timer/deadline.
  - BullShit response-window status.
  - Latest accepted action.
  - Recent claim timeline with at least the latest 2 to 3 claims visible and an expand affordance.
- Bottom hand/action dock:
  - Player's own cards.
  - Primary action button: Make Claim.
  - Secondary/destructive action: BullShit, shown only when legal.
  - Sort/view controls if useful.
- Claim picker opens as a bottom sheet.
- Round result/last-round review opens as a full-screen sheet or large modal after reveal.

Mobile wireframe target:

```text
+-------------------------+
| Room 4821        00:28  |
| [P2] [P3] [P4] [P5] ->  |
|                         |
| Current Claim           |
| FULL HOUSE              |
| Queens over Sevens      |
| by P4                   |
|                         |
| Claim Timeline          |
| P2: Pair 8s             |
| P3: Two Pair J/4        |
| P4: Full House Q/7      |
|                         |
| ----------------------- |
| Your cards              |
| <- [A-S] [7-H] [7-C] -> |
| [Make Claim] [BullShit] |
+-------------------------+
```

Mobile constraints:

- Minimum touch target: 44 x 44 CSS px.
- No accidental horizontal page scrolling.
- Intentional horizontal scrolling is allowed only for opponent rail, hand card rail, and card-review rows.
- Text must not overlap seats, cards, or controls.
- Player names must truncate gracefully.
- Claim labels must fit in chips at narrow widths.
- Cards in hand may fan, stack, or scroll, but selected/readable cards must be clear.
- A hand of 4 to 5 cards must never cover or hide the center claim zone or claim timeline.
- The center claim zone is sacred and must remain readable while the hand dock is open.
- Use safe-area padding for phone notches and bottom browser bars.
- Bottom controls must remain reachable with one thumb on common phone sizes.

### 15.4 Laptop/Desktop Layout

Target viewports:

- 1024 x 768
- 1280 x 800
- 1440 x 900
- 1920 x 1080

Desktop game layout:

- Table remains central.
- Circular poker table layout is allowed and preferred when there is enough space.
- Player seats may sit around the table, but they must not cover claims, timeline, controls, or reveal content.
- The same center claim command zone from mobile must still exist.
- Player hand and actions can be bottom-centered or in a protected lower panel.
- Claim history, action log, and player list may sit in a right rail.
- Last-round review still opens in a dedicated sheet/modal rather than being squeezed into the table.
- Lobby may use two columns: room setup and player roster.
- No feature should be desktop-only.
- A layout that looks more like a circular table is not acceptable if it makes claims harder to read than the mobile layout.

### 15.5 Lobby UX

Lobby screens:

- Create room.
- Join room.
- Waiting room.

Create/join screen:

- Name input.
- 4-digit numeric player PIN input.
- PIN input must be masked.
- PIN input accepts digits only and max length 4.
- Create room button.
- Join code input.
- Join room button.
- Rules button.
- Create is disabled until name is non-empty and PIN has exactly 4 digits.
- Join is disabled until room code is non-empty, name is non-empty, and PIN has exactly 4 digits.
- User-facing flow should mirror the Exploding Kittens reference: enter identity once, create a game or join an existing game.

Waiting room:

- Room code with copy/share.
- Seat slots for 2 to 10 players.
- Player list/seat grid with card-table styling.
- Host badge.
- Bot controls if enabled.
- Add/remove bots before game start.
- Bot difficulty display if supported.
- Timer setting, defaulted to 120 seconds.
- Locked rules summary:
  - Any active non-claimant may call BullShit.
  - Starting player final-decision rule.
  - Next starter rotates clockwise from previous starter.
  - Regular Flush uses reversed high-card ordering.
- Start button.
- Leave button.
- Ready/start state should make it clear why start is disabled.
- Copy/share room code must have success and fallback states.

### 15.6 Claim Picker UX

Claim picker requirements:

- Show only legal higher claims by default.
- Optionally allow a disabled/all view for learning, but disabled claims must explain why they are unavailable.
- Disable lower/equal choices.
- For each hand type, show the exact needed inputs:
  - Rank only.
  - Two ranks.
  - Suit plus rank.
  - Suit only for Royal Flush.
- Prevent invalid combinations before submit.
- Show concise validation errors only if needed.
- Make the submit button unavailable until claim is valid.
- Close after successful submission.
- If no higher legal claim exists, the picker must not show fake options; the UI must clearly direct the player to call BullShit.
- If the current player is the round starter on a final-decision turn, the picker must clearly label: "Final claim will be checked immediately."
- If a final claim is submitted, the UI must not open a BullShit response window.
- Claim picker must be usable with one hand on mobile.
- Claim picker must never obscure current claim context without repeating it in the sheet header.

Preferred interaction:

- Step 1: Select hand type with segmented/list control.
- Step 2: Select rank(s) and suit from large controls.
- Step 3: Confirm claim.

Picker quality bar:

- Hand types should be grouped by poker rank order.
- Rank selectors should be large, scan-friendly, and not tiny dropdowns.
- Suit selectors should use clear suit symbols/colors plus text labels for accessibility.
- A compact search/filter by hand type can be added if it improves speed.
- The submit state should show exactly what will be claimed before sending.

### 15.7 BullShit Action UX

- BullShit button appears only when legal.
- Because Section 3.2 allows any active non-claimant to call, the BullShit button can appear for multiple players at the same time.
- The claimant must never see BullShit as an available action against their own claim.
- The button must disappear or move to disabled/pending state immediately when the local client submits a call, but final authority comes from the server response.
- Pending text/state should say the call is being submitted, not that it already succeeded.
- If another player wins the BullShit race, show a concise message such as "P3 called first" and resync without treating it as an error in gameplay.
- If a next claim or final claim wins the race, show a concise stale-window message and resync.
- It must be visually distinct from Make Claim.
- It should require one deliberate tap/click.
- Optional confirmation can be enabled for first-time players, but should not slow regular play.
- On mobile, place it near the claim button but visually separated.
- The accepted BullShit caller must be shown in the claim command zone immediately after server acceptance and in the round result review.

### 15.8 Round Result UX

Round result must show:

- Claim that was challenged, final-claimed, or timeout/no-legal-claim reason.
- Claimant.
- BullShit caller when there was an accepted BullShit call.
- Explicit "No BullShit caller" text when the result came from a final claim.
- Penalty player when applicable.
- Whether claim was true or false.
- All revealed hands from that round.
- Proof cards when claim was true.
- Eliminations.
- Next round starting player.
- A one-sentence story of the round.

Required narrative examples:

- BullShit call, claim true: "P6 called BullShit on P4's Full House claim. The claim was true, so P6 got the penalty."
- BullShit call, claim false: "P6 called BullShit on P4's Full House claim. The claim was false, so P4 got the penalty."
- Final claim false: "P1 made the final claim. It was checked immediately and was false, so P1 got the penalty."
- Timeout: "P3 timed out and got the penalty."

Last-round review:

- The "Last round" button opens the same full review surface after the result is dismissed.
- Last-round review must never show only claimant and penalty while omitting the BullShit caller.
- Last-round review must include the accepted caller, claimant, claim, truth result, penalty, eliminations, next starter, and all revealed cards.
- If multiple players attempted to call BullShit, only the server-accepted caller is shown as the caller. Other attempts may be omitted or shown as stale attempts in a debug/detail area, but never as accepted calls.

Review layout:

- Mobile: full-screen sheet preferred.
- Desktop: large modal or side-by-side sheet is acceptable.
- Sticky summary at top: round number, claim, caller/final-claim/timeout status, truth result, and penalty.
- Tabs or segmented views:
  - Summary.
  - By Player.
  - All Cards.
  - Timeline.
- By Player view groups revealed cards by player. Each row must support horizontal scrolling if needed.
- All Cards view shows a dense grid of every revealed card from the round.
- Timeline view shows the claim sequence, BullShit call, final claim, timeout, and resolution events.
- Proof cards must be highlighted wherever they appear.
- Revealed cards must not be clipped. At 10 players with 5 cards each, all 50 cards must be inspectable.

The modal must not block the next round indefinitely. Players can dismiss it, and a "Last round" button can reopen it.

### 15.9 Opponent Rail And Player Status UX

Opponent/player status must show:

- Display name.
- Avatar or initials.
- Card count.
- Danger/penalty level.
- Current turn indicator.
- Current claimant indicator.
- Accepted BullShit caller indicator when relevant.
- Bot/human marker.
- Connected, reconnecting, disconnected, left, and eliminated states.

Opponent rail requirements:

- Mobile opponent rail uses a horizontal carousel/top rail.
- The active turn player should auto-scroll into view when needed.
- Eliminated players remain visible but visually subdued.
- Disconnected players remain visible; their timer still runs if it is their turn.
- Rail items must not resize the layout when names, statuses, or badges change.

### 15.10 Player Hand Dock UX

Player hand dock requirements:

- Shows the player's own private cards only.
- Supports 1 to 5 cards without covering the center claim zone.
- At 4 to 5 cards, use compact fan/stack or intentional horizontal card rail.
- Cards must remain inspectable; tapping/clicking a card may enlarge it.
- Provide sort controls if useful:
  - Sort by rank.
  - Sort by suit.
  - Reset/manual order if supported.
- Hand dock must include safe-area padding for mobile browser bars.
- The hand dock must not hide current claim, claimant, timer, claim timeline, or BullShit availability.
- Card art, rank, and suit must remain readable in the smallest supported mobile viewport.

### 15.11 Connection And Rejoin UX

Connection states:

- Connected.
- Reconnecting.
- Rejoined.
- Disconnected.
- Token mismatch.
- PIN mismatch.
- Room closed.

Required behavior:

- Show a non-blocking "Reconnecting..." banner during transient reconnects.
- Show "You rejoined as {name}" after successful reconnect.
- If reconnect token does not match, allow manual reclaim with the same normalized name and correct 4-digit PIN.
- If PIN does not match, show a friendly "PIN does not match this player" message and do not reveal whether any hidden cards exist.
- Do not silently hijack an existing seat.
- If a player disconnects during their turn, all clients should still see the timer and expected timeout behavior.
- Stale action errors caused by reconnect should trigger a quiet state resync.

### 15.12 Spectator, Eliminated, And Leave UX

- Eliminated players become spectators.
- Spectators can view public table state, claim timeline, last-round review, and game-over state.
- Spectators cannot see unrevealed private cards.
- Spectators and eliminated players must not see active Make Claim or BullShit controls.
- Voluntary mid-game leavers remain in history and are skipped for future starter rotation.
- The UI must clearly distinguish eliminated from disconnected and voluntarily left players.

### 15.13 Game Over And Rematch UX

- Game over must show winner, final standings, eliminated order, and key final round result.
- Rematch should allow same room/players when feasible.
- Rematch keeps players seated where possible.
- Rematch resets all game state cleanly.
- Bots can remain in rematch unless removed before the next start.
- Players who left should not be silently re-added to a rematch.

### 15.14 Accessibility

- Keyboard support for all buttons and form controls.
- Focus trap in modals.
- Escape closes modal where safe.
- ARIA labels for icon-only controls.
- Sufficient color contrast.
- Color is never the only indicator of status.
- Reduced motion mode must disable large animations and confetti.
- Timer should use text plus visual ring/bar.

## 16. Error Handling

All server errors should use structured codes:

```text
ROOM_NOT_FOUND
ROOM_FULL
NOT_ENOUGH_PLAYERS
GAME_ALREADY_STARTED
NAME_TAKEN
PIN_REQUIRED
INVALID_PIN_FORMAT
PIN_MISMATCH
RECONNECT_TOKEN_INVALID
NOT_HOST
NOT_CURRENT_TURN
PLAYER_ELIMINATED
NO_CURRENT_CLAIM
CLAIM_NOT_HIGHER
INVALID_CLAIM_SHAPE
STALE_TURN
STALE_STATE_REVISION
STALE_CLAIM_WINDOW
CLAIM_WINDOW_CLOSED
CLAIMANT_CANNOT_CALL
ROUND_ALREADY_RESOLVED
TURN_EXPIRED
ROOM_CLOSED
INTERNAL_ERROR
```

Client handling:

- Show friendly short messages.
- Do not expose stack traces.
- Automatically resync state after stale action errors.
- Keep local UI responsive but trust server response.

## 17. Testing Strategy

### 17.1 Unit Tests: Cards And Deck

Required tests:

- Deck has exactly 52 cards.
- Every card ID is unique.
- Each suit has 13 cards.
- Each rank has 4 cards.
- Shuffle does not lose or duplicate cards.
- Deal with 10 players at 5 cards each uses 50 unique cards.
- Eliminated players receive no cards.

### 17.2 Unit Tests: Claim Evaluation

Required High Card tests:

- High Card Ace true with any Ace.
- High Card 2 false when no 2 exists.

Required Pair tests:

- Pair 9 true with exactly two 9s.
- Pair 9 true with three 9s.
- Pair 9 false with one 9.

Required Two Pair tests:

- Two Pair Aces and Kings true with two Aces and two Kings.
- Two Pair Aces and Kings false with two Aces and one King.
- Two Pair rejects same ranks.

Required Three/Four tests:

- Three of a Kind true with three or four matching ranks.
- Four of a Kind true only with all four matching ranks.

Required Straight tests:

- A, 2, 3, 4, 5 makes 5-high straight true.
- 2, 3, 4, 5 without Ace makes 5-high straight false.
- 10, J, Q, K, A makes Ace-high straight true.
- Q, K, A, 2, 3 is false.
- Duplicate ranks do not break a valid straight.

Required Flush tests:

- Ace-high flush true with Ace plus four lower same-suit cards.
- King-high flush true with King plus four lower same-suit cards.
- 6-high flush true with 6 plus 2, 3, 4, 5 of the same suit.
- 5-high flush is invalid because no four lower ranks exist.
- Flush false with only four cards of suit.
- Flush false when required high-rank suit card is absent.

Required Full House tests:

- Full House Queens over 2s true with three Queens and two 2s.
- Full House Queens over 2s false with two Queens and three 2s.
- Full House rejects same trips and pair rank.

Required Straight Flush tests:

- 5-high straight flush true with suited A, 2, 3, 4, 5.
- 5-high straight flush false without suited Ace.
- King-high straight flush true with suited 9, 10, J, Q, K.
- Ace-high straight flush should be represented as Royal Flush, not Straight Flush.

Required Royal Flush tests:

- Royal Flush true only with 10, J, Q, K, A of same suit.
- Royal Flush false with one card off-suit.

### 17.3 Unit Tests: Claim Ordering

Required tests:

- Pair 10 beats Pair 9.
- Three of a Kind 2 beats Pair Ace because hand class is higher.
- Two Pair Kings and 3s beats Two Pair Queens and Jacks.
- Two Pair Kings and Queens beats Two Pair Kings and Jacks.
- Two Pair Kings and Jacks beats Two Pair Kings and 10s.
- Two Pair Aces and Kings beats Two Pair Kings and Queens.
- `getLegalClaimsAfter(Two Pair Kings and 10s)` includes Two Pair Kings and Jacks.
- `getLegalClaimsAfter(Two Pair Kings and 10s)` includes Two Pair Kings and Queens.
- `getLegalClaimsAfter(Two Pair Kings and 10s)` includes Two Pair Aces and Kings.
- Full House Queens over 2s beats Full House Jacks over Aces.
- Full House Queens over Kings beats Full House Queens over 10s.
- Full House Kings over Jacks beats Full House Kings over 10s.
- Full House Kings over Queens beats Full House Kings over Jacks.
- Full House Kings over Aces beats Full House Kings over Queens.
- `getLegalClaimsAfter(Full House Kings over 10s)` includes Full House Kings over Jacks.
- `getLegalClaimsAfter(Full House Kings over 10s)` includes Full House Kings over Queens.
- `getLegalClaimsAfter(Full House Kings over 10s)` includes Full House Kings over Aces.
- Straight 6-high beats Straight 5-high.
- Ace-high straight beats King-high straight.
- Flush King-high beats Flush Ace-high under locked reference-like flush ordering.
- Flush Queen-high beats Flush King-high under locked reference-like flush ordering.
- Flush 6-high beats Flush 7-high under locked reference-like flush ordering.
- Straight Flush King-high beats Straight Flush Queen-high.
- Royal Flush beats Straight Flush King-high.
- Royal Flush Hearts is not higher than Royal Flush Spades.
- Same hand, same rank, different suit is not higher unless future suit ranking is approved.

### 17.4 State Machine Tests

Required tests:

- Cannot start with fewer than 2 players.
- Cannot join full room.
- Cannot join with invalid 4-digit PIN format.
- Cannot join with duplicate normalized display name unless the PIN matches the existing player verifier.
- Correct PIN can reclaim an existing seat when reconnect token is missing.
- Wrong PIN cannot reclaim an existing seat.
- Name-only reclaim is rejected.
- Starting game deals one card to each active player.
- Default turn duration is 120 seconds.
- First claim can be any legal claim.
- Later claim must be strictly higher.
- Equal claim rejected.
- Lower claim rejected.
- Non-current player cannot submit a claim.
- Current player cannot call BullShit without current claim.
- Any active non-claimant can call BullShit on an open current claim, even when it is not their turn.
- Claimant cannot call BullShit on their own current claim.
- Eliminated players cannot call BullShit.
- Spectators cannot call BullShit.
- When turn returns to round starter with a current claim, starter can call BullShit.
- When turn returns to round starter with a current claim, starter can submit a final legal higher claim.
- Final claim resolves immediately without giving any player a BullShit response window.
- Final claim must still be strictly higher than the previous current claim.
- False final claim penalizes final claimant.
- True final claim ends round with no penalty.
- Final claim reveals all active round cards whether true or false.
- Correct BullShit call penalizes claimant.
- Incorrect BullShit call penalizes caller.
- Timeout penalizes current player.
- Timeout at 120 seconds increments the current player's `cardCount` by 1.
- Timeout reveals all active round cards in the round result.
- Timeout applies elimination if the timed-out player's `cardCount > 5`.
- Penalty to 6 eliminates player.
- Game ends when one active player remains.
- Bot can be added in lobby by host.
- Bot can be removed in lobby by host before start.
- Bot counts toward min and max player counts.
- Bot cannot see hidden cards beyond its own hand.
- Bot turn action uses the same claim validation path as human claim action.
- Bot out-of-turn BullShit call uses the same claim-window validation path as human BullShit call.
- Pending bot action is cancelled when claim window closes.
- New round clears current claim and claim history.
- New round deals cards equal to each active player's card count.
- Eliminated players receive no cards.
- Next starting player rotates clockwise from previous starter, skipping eliminated players and players who voluntarily left mid-game.
- Seat order A, B, C with A as previous starter and B eliminated yields C as next starter.
- Seat order A, B, C with A as previous starter and A eliminated yields B as next starter.
- Seat order A, B, C with A as previous starter and C eliminated yields B as next starter.
- Seat order A, B, C with A as previous starter and B voluntarily left mid-game yields C as next starter.

### 17.5 Race And Reconnect Tests

Required tests:

- Duplicate claim submit only applies once.
- Duplicate BullShit call retry only applies once.
- Two BullShit calls racing against the same claim window result in exactly one accepted call.
- BullShit call and next claim racing against the same claim window result in exactly one accepted action.
- BullShit call and final claim racing against the same claim window result in exactly one accepted action.
- BullShit call and timeout racing result in exactly one round resolution.
- Next claim and timeout racing result in exactly one accepted action or timeout resolution.
- Mid-game voluntary leave removes that player from future starter rotation.
- Pending action from a player who leaves mid-game is rejected.
- Pending bot action is cancelled when the referenced `claimWindowId` becomes stale.
- Bot and human BullShit calls racing against the same claim window result in exactly one accepted action.
- Bot final claim and human BullShit call racing against the previous claim window result in exactly one accepted action.
- A BullShit call with a stale `claimWindowId` is rejected after a newer claim is accepted.
- A claim submit with a stale `claimWindowId` is rejected after a BullShit call is accepted.
- A BullShit call after final claim acceptance is rejected because no claim response window exists.
- Stale turn ID rejected.
- Stale state revision rejected or resynced.
- Action after timeout rejected.
- Refresh/reconnect preserves player's seat and private hand.
- Refresh with a valid reconnect token preserves player's seat and private hand without retyping PIN.
- Same room code, same normalized name, and correct 4-digit PIN reclaims the same seat when reconnect token is missing.
- Same room code, same normalized name, and wrong 4-digit PIN is rejected with `PIN_MISMATCH`.
- Name-only seat reclaim is never allowed.
- Raw PIN is never included in public state, action logs, or production logs.
- Repeated failed PIN attempts are rate-limited.
- Disconnected player still times out.
- Private cards are never included in public state before reveal.

### 17.6 End-To-End UI Tests

Required Playwright/mobile tests:

- Create room on mobile viewport.
- Create room requires display name plus 4-digit numeric PIN.
- Join room from second browser context requires room code, display name, and 4-digit numeric PIN.
- PIN input accepts digits only, masks value, and caps at 4 digits.
- Start game.
- Player sees only their own cards.
- Other players' cards render as backs/counts.
- Make legal claim.
- Illegal lower claim unavailable or rejected.
- After Two Pair Kings and 10s, claim picker offers Two Pair Kings and Jacks, Kings and Queens, and Aces and Kings.
- After Full House Kings over 10s, claim picker offers Full House Kings over Jacks, Kings over Queens, and Kings over Aces.
- Call BullShit.
- Round result reveals all hands.
- Penalty count updates.
- Player eliminated after exceeding 5 cards.
- Winner screen appears.
- Layout has no overlapping text/controls at 360 x 640.
- Mobile opponent rail remains usable with 8 to 10 players.
- Mobile hand dock with 5 cards does not cover current claim, timer, claimant, BullShit availability, or recent claim timeline.
- Claim picker is usable at 390 x 844.
- Claim picker repeats current claim context while open.
- BullShit call pending state appears after tap.
- If two players race to call BullShit, only the server-accepted caller appears in round result.
- Last-round review shows accepted BullShit caller, claimant, penalty player, claim truth, and round narrative.
- Last-round review shows all revealed cards for a 10-player, 5-card stress case without clipping.
- Proof cards are highlighted for a true claim when `proofCardIds` are available.
- Eliminated player sees spectator UI without action buttons.
- Reconnect banner and successful rejoin message appear in reconnect test.
- Desktop layout is usable at 1440 x 900.
- Desktop circular table preserves protected center claim command zone.

### 17.7 Performance Tests

Targets:

- Initial load under 3 seconds on normal mobile network after assets are cached.
- Turn action server round trip feels immediate; optimistic UI may show pending state but must reconcile.
- 60 fps for basic UI animations on modern mobile.
- No expensive hand-evaluation loops in render.
- Bot probability simulation must be bounded and server-side.

### 17.8 Tooling And Static Quality Tests

Required checks:

- `npm run lint` passes.
- `npm run format:check` passes.
- `npm run typecheck` passes.
- `npm run test` passes.
- `npm run test:e2e` passes for required browser flows.
- `npm run build` passes.
- No client bundle contains test-only secrets or private card data fixtures.
- No source file that contains UI rendering should also contain authoritative card/claim evaluation logic.
- No React page component should exceed 300 lines without a documented split plan.
- No hidden card field should appear in the public-state TypeScript type.
- No `Math.random()` should be used inside pure engine logic; injected RNG only.

## 18. Implementation Plan

### Phase 0: Confirm Decisions

Tasks:

- Resolve all Section 3 decision items.
- Lock the final game rule text.
- Confirm Cloudflare Pages, Workers, and Durable Objects as the locked backend/deployment target.
- Confirm the locked premium tactile bluff-table visual direction from Section 3.7.
- Confirm the locked room-code plus 4-digit player PIN identity model from Section 3.8.
- Confirm the locked `BullShit Poker` title and 120-second default turn timer from Section 3.9.

Acceptance criteria:

- No `Decision Needed` remains unresolved.
- Final spec version is marked ready for implementation.

### Phase 1: Pure Game Engine

Tasks:

- Create card types, deck creation, shuffle, and deal functions.
- Create claim types and legal claim generation.
- Implement claim comparison.
- Implement claim evaluation.
- Implement state machine transitions.
- Implement round resolution.
- Write unit tests for all card and claim logic.

Acceptance criteria:

- All unit tests in Sections 17.1 through 17.4 pass.
- Engine has no dependency on React, network, browser APIs, or storage.

### Phase 2: Backend Authority

Tasks:

- Create Cloudflare Worker entrypoint.
- Create Cloudflare Durable Object room authority.
- Create room-code lookup service.
- Create player identity/reconnect tokens.
- Create 4-digit player PIN verifier and reclaim flow.
- Add failed PIN attempt rate limiting.
- Create WebSocket event protocol.
- Implement room lifecycle.
- Implement Durable Object alarms for server timers.
- Implement private state delivery.
- Implement race protection with turn IDs.
- Implement free-tier-safe WebSocket hibernation behavior.
- Add integration tests.

Acceptance criteria:

- Two simulated clients can play a complete game.
- Hidden cards are never present in public state.
- Race tests pass.
- Server can recover room state or intentionally close stale rooms.

### Phase 3: Mobile-First UI

Tasks:

- Build app shell.
- Build create/join/lobby screens.
- Build masked 4-digit player PIN input and validation.
- Build mobile opponent rail/top carousel.
- Build desktop circular table layout with protected center command zone.
- Build protected center claim command zone.
- Build player seat/status component.
- Build hand dock and card inspection behavior.
- Build timer display.
- Build claim timeline/action log.
- Build claim picker bottom sheet.
- Build BullShit action and race feedback.
- Build round result reveal and last-round review sheet.
- Build proof-card highlighting.
- Build game over/rematch screen.
- Build action log inspired by the Exploding Kittens `usedCardsDetails` pattern.
- Build capacity slots in lobby inspired by the Exploding Kittens lobby, adapted as poker seats.
- Build spectator/eliminated display states.
- Build reconnect/disconnect banners.
- Add responsive styling for mobile and desktop.

Acceptance criteria:

- Primary game actions are usable on 360 x 640.
- No overlapping UI in tested mobile sizes.
- On mobile, the opponent rail/top carousel and hand dock do not cover the center claim command zone.
- A 4 to 5 card hand remains inspectable without hiding current claim, timer, claimant, or claim timeline.
- Last-round review can display all revealed cards for 10 players with 5 cards each without clipping.
- Last-round review shows accepted BullShit caller, claimant, claim, truth result, penalty, eliminations, next starter, and proof cards when available.
- Desktop view uses available space without feeling stretched.
- Desktop circular table layout must not reduce claim readability compared with mobile.
- UI receives all game data through typed client state, not direct engine mutation.
- The visual style clearly blends Exploding Kittens-inspired tactile physicality with calmer premium poker-table readability.

### Phase 4: Bots

Tasks:

- Implement server-side bot identity.
- Implement bot action scheduler.
- Implement bot probability estimator.
- Implement bot claim strategy.
- Implement bot out-of-turn BullShit challenge strategy.
- Implement bot final-decision behavior.
- Implement bot action cancellation on stale claim windows.
- Add deterministic bot tests.

Acceptance criteria:

- Human can start a game with bots.
- Bots cannot see hidden cards they should not know.
- Bot action always passes the same validation path as human action.
- Bot behavior is deterministic under a seeded RNG in tests.
- Bot pending actions do not fire after their referenced window or turn becomes stale.

### Phase 5: QA And Hardening

Tasks:

- Add Playwright tests for mobile and desktop flows.
- Add accessibility checks.
- Add reduced motion behavior.
- Add error-state tests.
- Add reconnect tests in browser contexts.
- Run manual gameplay sessions with 2, 3, 6, and 10 players.

Acceptance criteria:

- All automated tests pass.
- Manual test checklist completed.
- No known rules bugs remain unresolved.
- Known tradeoffs are documented.

### Phase 6: Deployment

Tasks:

- Configure Cloudflare Pages/static frontend deployment.
- Configure Cloudflare Worker deployment.
- Configure Durable Object bindings and migrations.
- Configure environment variables.
- Configure production build.
- Add Durable Object alarm-based room cleanup.
- Add basic observability.
- Document free-plan guardrails and paid Cloudflare products that must stay disabled.

Acceptance criteria:

- Production build passes.
- Deployed game can create/join/play/end a match.
- Stale rooms are cleaned up.
- Error logs do not contain hidden card data.
- The deployed MVP does not require any paid Cloudflare plan or paid add-on for the owner's expected personal usage.

## 19. AI Implementation Instructions

When this spec is given to an AI coding agent:

1. Read this entire spec before writing code.
2. Do not implement until Section 3 decisions are resolved.
3. Build the pure engine first.
4. Write tests for card and claim logic before UI.
5. Do not put authoritative game rules in React components.
6. Do not expose hidden cards in public state.
7. Do not silently change rules to simplify implementation.
8. If the spec conflicts with itself, stop and ask the owner.
9. If a rule is not covered, stop and ask the owner.
10. Prefer small, typed, tested modules over one large file.
11. Keep UI smooth, but never at the cost of server authority.
12. Run tests before claiming the work is complete.
13. Borrow the Exploding Kittens repo's modular page/service/constants organization and bold tactile design language.
14. Do not inherit the Exploding Kittens repo's hidden-card exposure, lack of tests, name-keyed identity, or oversized game component.
15. Keep the Cloudflare Durable Object room authority as the only process that can apply authoritative game transitions.

## 20. Definition Of Done

The project is complete when:

- All owner decisions are resolved and reflected in the spec.
- Game engine is fully typed and tested.
- Multiplayer works with hidden-card privacy.
- Mobile UI is polished and usable.
- Laptop/desktop UI is polished and usable.
- Round flow, penalties, eliminations, timers, reconnects, and game over all work.
- All required unit, integration, race, and E2E tests pass.
- Production build succeeds.
- The implementation has no known unresolved rule ambiguity.

## 21. Owner Review Checklist

All owner review items required before implementation have been resolved.
