# Poker V3 recovery handoff

Updated: 2026-09-11 (America/Los_Angeles). Status: recovered defect pass validated and deployed to the isolated V3 Worker with user approval; V1/V2 not promoted or changed.

## Workspace and preservation

- Verified directory: `/Users/jaswanth/Documents/Codex/2026-04-24/hey-i-want-to-build-a`. The supplied expected-directory field was a placeholder; both Git and the uniquely matching saved task identify this directory.
- Branch: `codex/v3`, tracking `origin/codex/v3`; recovery-start HEAD: `a3da359` (Replace V3 with a responsive spatial bluff arena).
- No repository/ancestor `AGENTS.md` found; `~/.codex/AGENTS.md` exists and is empty. No `.openai/hosting.json` in this project.
- Preexisting unrelated tracked edits: `src/client/App.tsx`, `src/client/styles.css`, `src/shared/bots/botDecision.ts`, `tests/shared/botDecision.test.ts`, `wrangler.toml`. Preexisting untracked work: `v2/`, `bullshit-poker-v2-spec.md`. Preserve all of these.
- Preexisting V3 edits: `v3/src/client/App.tsx`, `v3/src/durable-objects/roomAuthority.ts`, `v3/src/durable-objects/roomSessions.ts`, `v3/src/worker/roomRoutes.ts`.
- Recovery-start patch and hashes: `/tmp/poker-v3-recovery-start.patch`, `/tmp/poker-v3-recovery-start-hashes.json` (temporary evidence; not a durable backup).
- All continuation edits are limited to `v3/`, `bullshit-poker-v3-spec.md`, and this handoff. Following recovery, the user explicitly requested “ok deploy to v3”; only the V3 Worker was deployed. No commit or V1/V2 promotion was performed.
- Final preservation check compared all **83** preexisting non-V3 modified/untracked files against their starting SHA-256 hashes: every one matched.

## Recovered context and evidence

`CODEX_HOME` is unset, so the default `/Users/jaswanth/.codex` applies. The app task list and `session_index.jsonl` uniquely identify **Create BullShit poker spec**, task `019dc2e4-6a6e-7d52-af69-d764c995fd6c`, with the same working directory.

Recovered from targeted bounded reads of:

`/Users/jaswanth/.codex/sessions/2026/04/24/rollout-2026-04-24T21-27-22-019dc2e4-6a6e-7d52-af69-d764c995fd6c.jsonl`

- Line 18719, 2026-09-09 00:09:06 UTC: user requests automatic next rounds without a button and improved mobile composition consistent with desktop.
- Line 18780, 00:14:51 UTC: user explicitly approves immediate dealing, a nonblocking result notification, and full reveal only via Last Round. This supersedes older review/countdown behavior in the specification and tests.
- Line 18789, 00:15:06 UTC: user requests a broad adversarial audit and fixes for demonstrated gaps.
- Lines 18922, 18962, 18987 contain the final interrupted server/client patches. A completed patch is evidence of an edit, not a passing build or validated behavior.
- The user also pasted the consolidated approved scope into this recovery task, resolving the remaining ambiguity about UI language, reconnect buttons, and responsive work.

Project references: `bullshit-poker-v3-spec.md`, `v3/README.md`, inherited V2 rules/spec and V3 tests. Historical spec deployment/version claims are not evidence that the current dirty tree is deployed. Preserve V1/V2 and their Workers; V3 configuration targets only `bullshit-poker-v3` / `RoomDurableObjectV3`.

## Approved requirements

1. Resolve, store the complete reveal, and immediately redeal as one serialized persisted authority transition. A restart must not strand a room in review. Recover legacy persisted `ResolvingRound` rooms. Do not change claim order, penalties, elimination, starter rotation, winner logic, frozen round pools, or hidden-card privacy.
2. No next-round button/countdown or automatic blocking reveal. Show a brief nonblocking result notice; retain complete reveal under Last Round.
3. Reactions expire three seconds after receipt. A newer reaction replaces the old one and restarts its timer. Reconnect and unrelated updates must not replay expired reactions.
4. Background automatic reconnection; remove every manual refresh/reconnect button. Commands depend on the accepted authoritative connection. Test duplicate/stale commands, reconnect/leave races, session replacement, host transfer, rematch and winner paths.
5. Validate stored credentials/preferences; invite links must not restore a saved seat from a different room.
6. Use one overlay controller; clear stale claim UI when authority advances. Prevent stacking, preserve keyboard focus, provide Escape/Tab behavior and accessible status announcements.
7. Rebuild narrow/mobile arena as separate responsive zones. Prevent overlap among turn text, table, timeline, actions, player rail and hand. Remove intersecting mobile blue/orange rails and use restrained perimeter accents. Preserve desktop styling except necessary shared corrections.
8. Fit Three.js lobby/game cameras to actual container aspect and full table bounds with breathing room. Keep the HTML game usable under WebGL rejection/context loss or renderer exceptions.
9. Remove `LIVE TABLE / 03` including `03`, and `Private channel`. Use `Live social bluffing`, `Start fresh`, and `Lock onto a room`.
10. Verify entry, lobby, live game, claim picker, reactions, Last Round, settings, share, confirmation and winner screens across narrow/standard/large phones, landscape, tablets/laptops, long names, ten players and large hands. Exercise Reduced Effects and accessible input.

## Recovery-start verification

- Atomic resolution/redeal code and legacy review recovery were already edited into the server; existing callers/tests were incomplete.
- Invite-room filtering, credential validation, timers, background reconnect scaffolding and single-overlay state were partly present in `App.tsx`; old overlay variables and handlers remained, so this was not a finished implementation.
- `npm run typecheck` failed: incomplete client refactor (removed identifiers, missing ref initialization/types) and outdated server test signatures/options.
- `npm test`: **142 tests, 136 passed, 6 failed**. Raw baseline output: `/tmp/poker-v3-baseline-tests.log`. Failures concern old review/advance expectations and updated authority call signatures. No browser/build success is claimed for this starting tree.
- Additional demonstrated client gaps: mount ordering can skip saved-seat reconnection; transport-open can enable commands before session acceptance; handlers bypass pending-action guards.
- Additional demonstrated server gap: PIN reclaim over HTTP can leave the replaced socket authoritative until a replacement WebSocket connects.

## Continuation changes and final validation

### Server and shared rules

- `roomAuthority.ts`: verified resolution plus redeal is serialized and stored once for BullShit calls and final claims. The terminal winner path stays GameOver. Regressions prove a new authority reads the next round after restart, RNG/storage failures leave the prior state intact, and retries do not double-penalize.
- `roomSessions.ts`: verified legacy review saves advance during reconnect, including concurrent reconnects. Removed the former in-memory next-round delay. Bots use the same atomic action path.
- `roomDurableObject.ts` / `roomRoutes.ts`: HTTP join/PIN reclaim is routed through the session queue. Successful reclaim immediately revokes the old live socket, broadcasts the latest state and reschedules bots. Stale socket commands/close callbacks cannot mutate a replacement seat.
- Accepted command IDs have a bounded **128-entry per-connection** receipt cache. Replaying Add Bot or Ready does not repeat the mutation; conflicting reuse of an ID is rejected. Unexpected command failures retain the rejected request ID. Persisted leave receipts and existing revision/turn/window validation remain in place.
- `compareClaims.ts` / `roomReducer.ts`: malformed JSON hand categories, ranks and suits are rejected before persistence. Server stamping discards caller-supplied metadata. Both claims are validated even when comparing different categories.
- `shuffle.ts`: nonfinite RNG values now throw instead of creating an invalid shuffled deck.
- `botDecision.ts`: probability estimates count the frozen round's public participant/card counts after a departure. They do not inspect another player's private hand. Tests distinguish current-round departures from historical seats and prove private hand contents do not influence estimates.
- Locked category ordering, reversed ordinary flush ordering, final claims, elimination threshold, frozen evaluation pools, starter rotation and hidden-card views remain covered by the shared rule suite.

### Client, overlays and rendering

- Completed the interrupted single-overlay refactor and removed every old Boolean setter/reference. Dialogs trap Tab/Shift+Tab, restore focus, use semantic labels, and make the background inert. Browser Back opens the safe leave confirmation. Claim windows close when authority changes match, round, turn or claim window, or reconnect synchronizes state.
- Gameplay commands require the current **server-accepted** connection, not just an open transport. Pending commands block duplicate taps. Offline controls disable; background reconnect uses capped retry delays, heartbeat/connect timeouts, and online/visibility recovery. Leave retries preserve their original request/match identity.
- Same-seat replacement is terminal for the old tab: it returns to entry with a notice, stops reconnecting, and preserves the saved credential for the new tab. Credential removal only clears the credential owned by that tab. This prevents reconnect ping-pong and old-tab deletion of a newly reclaimed saved seat.
- Saved credentials/preferences are validated and tolerate unavailable storage. An invite for another room opens its join flow instead of restoring the saved seat. Browser reload restores the same seat automatically.
- Reactions have an explicit three-second timer, replacement starts a new timer, and reconnect/older snapshots cannot replay them. The event bus ignores older revisions and isolates failing visual listeners.
- Resolution produces a brief nonblocking result notice; the next round is immediately playable. Last Round/Final Reveal opens only on deliberate input and holds a fixed snapshot while later rounds continue. It includes full frozen hands, proof cards, claimant/caller or automatic-final-claim explanation, next starter and eliminations.
- Added semantic connection/turn/claim/result announcements and accessible preference toggle states. Independent haptics and Reduced Effects behavior remains tested.
- Updated entry text and removed manual reconnect controls, `LIVE TABLE / 03` and `Private channel`. Mobile arena now has explicit summary, scene, timeline and action zones. Lobby table/message flow and 44px controls avoid decorative collisions. Five-card hands shrink within narrow phone width; the browser test caught and fixed a fifth-card edge clipping at 320px.
- `sceneFraming.ts` fits the entire stable scene envelope using actual container aspect, depth and perspective with an 8% inset. Entry/lobby/game cameras recompute on resize, including narrow/tall and zero-size initialization cases. Tests project table geometry, ten seat markers and entry motion envelope into camera bounds.
- Scene initialization errors have a React boundary; render/resize/context-recovery failures use the nonblocking fallback. Real browser context loss and renderer initialization rejection retain usable HTML controls.

### Checks and artifacts

All commands below ran from `v3/` with Node **v25.9.0** and the installed dependencies; no dependency upgrade was made.

| Check | Final result |
| --- | --- |
| `npm run check` | Passed: TypeScript, ESLint, **165/165** unit/integration tests, Vite production build |
| Build after the final narrow-hand CSS correction | Passed |
| `npm run test:ui -- --workers=1` | **24/24 passed**, final complete run 54.3 seconds |
| Changed-source/test formatting and `git diff --check` | Passed |
| Unrelated starting-file hashes | All **83** preserved |

The browser suite exercised Chrome against **`http://127.0.0.1:8791`**, using only the V3 config and `/tmp/poker-v3-recovery-worker` persistence. The existing test named “production smoke” also ran against localhost; it is **not** evidence of a remote deployment check. Chrome and localhost binding initially failed under the sandbox; the authorized elevated test/server launch resolved those environment failures. Later test-locator errors were corrected without weakening gameplay assertions. All final browser cases passed.

Coverage includes entry/PIN/share flows, saved-seat/invite/replaced-tab behavior, offline reconnect and disabled commands, focus/Back/overlays, immediate redeal/manual reveal, reaction replacement/expiry/no replay, real WebGL loss and initialization fallback, Reduced Effects stable frames, active leave/frozen pool, host end/rematch, a complete natural two-player match, elimination and final reveal, five-card hands at 320px, 2–10-player lobbies, six long human names, ten-player reveal scrolling, and mobile portrait/landscape/tablet/laptop layouts. New game/claim geometry matrix: 320×760, 390×844, 430×932, 844×390, 768×1024 and 1440×900; existing lobby matrix includes 768×900.

Logs: `/tmp/poker-v3-final-check.log`, `/tmp/poker-v3-ui-verified.log`. Generated screenshots are under `v3/test-results/` (ignored by Git and replaced on later test runs). Visually inspected screenshots include narrow game/claim layouts, the five-card hand, natural winner, and the final responsive captures. Camera tests assert projected bounds and browser canvas checks assert nonblank output; these do not substitute for device performance measurements.

## End-to-end review map

- Read all three game specifications, both project READMEs and the original visual reference audit, with targeted recovery of the saved conversation. The original 2,466-line rules spec and 832-line V2 spec contain superseded language and deferred infrastructure as well as locked game rules. The explicit September 8 approval controls immediate redeal and reconnection behavior; the V3 spec now says so.
- Traced the runtime from React entry/create/join through Worker routing, identity/token validation, Durable Object session queue, serialized authority/storage, pure claim/lifecycle/resolution logic, per-player views, WebSocket delivery, client reconciliation, overlays and visual events/scenes. Reviewed deck/shuffle, bot strategy/probability, card/claim controls, styling, PWA shell and test coverage.
- Compared inherited V1/V2/V3 source boundaries and shared-rule tests. V3 began with the V2 bot/cards/evaluator/legal-claim/seat baseline; this pass changes validation and frozen-pool probability, not the approved poker rules. V1/V2 implementations and dormant unrelated files were preserved.

## September 8 V3 deployment (historical)

- User approval: “ok deploy to v3” on 2026-09-08 (local date).
- Target: `https://bullshit-poker-v3.every-day.workers.dev/`.
- Deployed with `./node_modules/.bin/wrangler deploy --config wrangler.toml --name bullshit-poker-v3` from the isolated `v3/` directory, reusing the validated build.
- Version deployed in the recovery pass: **`f8d9b90e-48a6-432f-bf9b-19595c87c28c`**; superseded by the September 10 animation correction below.
- Previous active version, verified through Wrangler before deploy: **`17b730eb-e7bd-40f2-ada0-4f64e31aa760`** (rollback reference).
- Confirmed the V3 `PIN_SECRET` binding exists; no secret values were read or changed.
- Wrangler confirmed only `bullshit-poker-v3`, `RoomDurableObjectV3`, V3 static assets and `APP_VERSION=3.0.0` as deployment targets/bindings. Neither protected V1/V2 Worker was targeted.
- Live HTTP page verification passed and referenced the tested `/assets/index-C3hVlgW9.js` and `/assets/index-DE_WelNz.css`.
- Live Chrome smoke **1/1 passed**: created a disposable V3 room, connected to the lobby, permanently left, and returned to entry. Command: `PLAYWRIGHT_BASE_URL=https://bullshit-poker-v3.every-day.workers.dev npm run test:ui -- --workers=1 --grep 'production smoke' --output /tmp/poker-v3-deploy-smoke`.
- This live smoke supplements the 165 unit/integration and 24 local browser checks above; the full browser suite was not rerun against public rooms.

## Unfinished work, uncertainties and next steps

- **V3 is deployed and ready for user review.** Protected V1/V2 promotion still requires separate explicit approval. Working-tree changes remain uncommitted; the current deployed and rollback versions are recorded in the latest follow-up below.
- **Device/browser/performance matrix remains partial:** current validation is desktop Chrome at multiple viewport sizes. Real iOS Safari/Android, desktop Safari/Firefox, representative hardware frame time/memory/battery, zoomed text and a full assistive-technology/contrast audit remain to be done before promotion.
- **Inherited infrastructure/security work remains:** Durable Object hibernating sockets, persisted bot scheduling/cleanup alarms, inactivity retention, PIN/join/create throttling, WebSocket Origin validation, removal of the production fallback secret and server-side name-length limits. These are existing baseline/spec gaps, not claimed fixed by this pass. In particular, new rounds no longer depend on an in-memory timer, but bot scheduling still does and is rescheduled on connection/activity.
- **Bounded duplicate protection:** ordinary accepted command receipts are connection-local and capped at 128; leave receipts are persisted. Ordinary commands are not automatically replayed across reconnect. This is not a durable exactly-once command ledger across arbitrary restarts or unlimited request replay.
- **Product roadmap remains:** optional Google accounts, D1 profiles/history, localization, WebGPU, rolling performance adaptation, shared resource management, cinematic penalty travel and expanded original audio are not implemented here. Do not interpret the older specs' definition-of-done lists as evidence they exist.
- **Maintainability:** `App.tsx` still combines many screen components and a large connection controller. Extracting the controller and screens behind these regressions is a future cleanup; this pass prioritized completing the interrupted behavior without changing V1/V2. Obsolete internal HTTP client helpers remain unused by the UI; public unauthenticated mutation routes are blocked.
- **Build budget:** the lazy Three.js/runtime chunk remains about 535 kB minified (134 kB gzip) and triggers Vite's >500 kB warning. The build succeeds; this is not a measured mobile performance pass.
- No missing recovered requirement currently requires a user answer to implement the approved defect pass. All changes remain available as an uncommitted working-tree diff for review.


## September 10 animation clarity follow-up

User reported unclear animations on mobile and desktop and requested the fix on the existing V3 task.

Verified causes: entry fog desaturated the foreground cards/rings; automatic mobile rendering disabled antialiasing and capped DPR at 1.25; table framing reserved empty rectangular corners; WebGL line edges were only one pixel; claim cards were small, angled away from the camera, and continuously rotated through edge-on/backwards poses; Reduced Effects dimmed the entire scene to 38% opacity.

Implemented in V3 only:

- Remove entry fog, use unlit card-face textures, enlarge the central deck, thicken orbit rings and center the phone composition horizontally.
- Fit the table platform, seat envelope and animated card fan as a stable point envelope. Adjust the optical center and scene height to use available space without cropping or moving the camera on each claim.
- Replace one-pixel table edges with mesh rails, strengthen the table surface and seat markers, and give the BullShit shock ring a thicker, slower outward pulse.
- Enlarge claim cards with clear ranks, increase their spacing, face them toward the camera, and replace continuous spinning with a bounded gentle sway and accepted-event scale pulse.
- Enable antialiasing and cap full/balanced DPR at 2/1.75. Reduced Effects renders a crisp static scene with full contrast; it still stops continuous frames.
- No server, game-rule, reconnect, or reaction-timer changes in this follow-up. V1/V2 and unrelated starting changes remain preserved.

Validation: `npm run check` passed TypeScript, ESLint, **167/167** unit/integration tests and the production build. New projection tests exercise an hour of sampled claim motion, all five card corners, a minimum 40 CSS-pixel card height in small containers, and fixed Reduced Effects poses. The high-DPI browser test checks 320/390/1440px views, actual canvas resolution, five-card claims, identical Reduced Effects frames, and immediate redeal with a visible result. **25/25** Chrome browser tests passed in **56.1 seconds**. `git diff --check` passed and all 83 unrelated starting-file hashes still matched.

Artifacts: `/tmp/poker-v3-animation-check.log`, `/tmp/poker-v3-animation-ui.log`; screenshots in `v3/test-results/animation-*.png`. Inspected mobile/desktop five-card claims, mobile result pulse, Reduced Effects, entry and lobby/game captures. The initial browser attempt hit a stale local server on port 8791; the final run uses an isolated Worker on port 8792 with `/tmp/poker-v3-animation-worker` storage.

Limitations: real phone GPU performance and Safari/Firefox remain unmeasured. The sharper DPR setting increases raster work; it stays capped and hidden tabs/Reduced Effects stop animation. The lazy Three.js/runtime chunk is now about 548 kB minified / 138 kB gzip and retains the existing build warning.


### Follow-up deployment and live verification

- Deployed September 10 with the existing explicit V3 deployment authorization using `./node_modules/.bin/wrangler deploy --config wrangler.toml --name bullshit-poker-v3`.
- Animation-correction version: `229c18d7-0a15-4a0c-9be6-52aa3b42e172` (superseded by the entry redesign below).
- Previous active version verified before upload / rollback reference: `f8d9b90e-48a6-432f-bf9b-19595c87c28c`.
- URL: https://bullshit-poker-v3.every-day.workers.dev/ . Only V3 Worker/assets/bindings targeted.
- Live HTTP returned the exact tested `index-17I_vNL3.js` and `index-DZ_6jCEc.css` asset references.
- Live Chrome **3/3 passed**: phone entry, desktop entry, and a disposable room create/connect/permanent-leave smoke. Log: `/tmp/poker-v3-animation-live.log`. Local gameplay and animation checks remain separate from these narrower live checks.
- Handoff/spec updated; changes remain uncommitted. No V1/V2 or unrelated file modifications.


## September 10 entry redesign follow-up

User supplied a 748×1576 screenshot (374×788 CSS viewport at 2× scale), identified unused entry-page space, and explicitly requested a more creative redesign.

Rebuilt the entry as a poker-club poster with a compact masthead, oversized title, short game introduction, framed live card artwork, adjacent Create/Join actions, and a three-step rules strip. Desktop uses a split composition; phones use consecutive content zones. The entry scene now occupies its own sized stage and uses a centered camera. Enlarged the deck, tightened its surrounding orbits, and kept full containment. Added a CSS card illustration for WebGL fallback. Existing PIN/create/join handlers and all game/server logic are preserved.

Concrete layout benchmark: at 374×788, headline block ends at 276px, artwork starts at 294px and ends at 566px, action buttons start at 584px and end at 664px. The two inter-section gaps are 18px. Compared with the supplied screenshot’s action top of approximately 674 CSS px, the actions arrive about 90px earlier. This is a layout measurement, not a claim about conversion or performance. The short guide continues below the fold on compact phones; actions remain within the initial viewport.

New browser layout assertions cover 320×760, 374×788, 390×844, 430×932, 768×1024, 844×390, 1440×900 and 1920×1080: no horizontal overflow, separate poster/text zones, accessible three-step list, bounded phone gaps and first-screen actions. Existing create/join input, PIN masking, shared invite, Reduced Effects and fallback cases remain in the suite. `npm run check` passed TypeScript, ESLint, 167 unit/integration tests and build; **26/26** full browser cases passed in about 1.1 minutes. All 83 unrelated starting-file hashes remain unchanged.

Artifacts: `/tmp/poker-v3-entry-check.log`, `/tmp/poker-v3-entry-ui.log`, and `v3/test-results/entry-poster-*.png`. Visually inspected 374px phone and 1440px desktop. Physical-device performance and Safari/Firefox limitations remain unchanged.


### Entry redesign deployment

- September 10 entry version: `e50904e6-bfe0-49a8-9840-3fec22a131d2` (superseded by the sculpture revision below).
- Previous version / rollback reference: `229c18d7-0a15-4a0c-9be6-52aa3b42e172`.
- Published with the existing authorized V3-only Wrangler command. No V1/V2 Worker or unrelated files changed.
- Live HTTP matches the tested `index-CBsQKeag.js` and `index-D7S1-m0X.css` build.
- Live Chrome **3/3 passed** in 7 seconds: phone entry/create/join steps, desktop entry/create/join steps, and disposable room create/permanent-leave. Log: `/tmp/poker-v3-entry-live.log`.
- Changes remain uncommitted; updated this handoff and the V3 specification.


## September 11 animated sculpture / minimal-copy follow-up

User requested more ambitious, smooth and clear entry animations, then explicitly removed “THE SHORT VERSION” and the surrounding explanatory text. This supersedes the September 10 masthead, introduction, framed caption and rules-strip requirements.

Final entry retains the title, Live social bluffing kicker, one tagline, Create/Join actions and the animation replay control. Removed the masthead, artwork header/caption, introductory paragraph and entire rules guide from the DOM and their later CSS rules. A larger borderless 3D scene occupies the main visual zone; the desktop title/actions form one centered group and phones retain bounded sequential zones.

Animation implementation:

- A deterministic, eased 16-second cycle unfolds 13 deck layers into a fan, suspends them, then gathers them back. Visible textured backs and the main question card stay legible.
- Four face-up cards orbit in the foreground, counter-rotating broken ring arcs sweep around the deck, and blue/orange diamond streams use one instanced draw (12 instances balanced, 24 full quality).
- Pointer response uses stage-local coordinates and delta-based damping. Replay blends the fan closed without resetting orbital positions.
- Frames stop for offscreen artwork, hidden tabs and open create/join forms. Reduced Effects/system Reduced Motion render one fixed open fan and hide the replay control. WebGL fallback remains a CSS card illustration.
- Geometry/material/texture/instance resources and observers/listeners are disposed on teardown. No new dependencies or server/game-rule changes.

Validation: `npm run check` passed TypeScript, lint, **170/170** unit/integration tests and build. New numerical regressions check easing/loop continuity, every deck/satellite corner through the full cycle and extreme pointer tilts, and Reduced Effects invariance. Browser tests exercise changing rendered frames, replay, pause during entry/offscreen, restoration and system reduced motion. The eight-size layout check now asserts the removed explanatory DOM stays absent and first-screen phone actions remain reachable. **27/27** full Chrome browser tests passed in about 1.3 minutes. Live deployment results follow below.

Artifacts: `/tmp/poker-v3-choreography-check.log`, `/tmp/poker-v3-choreography-ui.log`, `v3/test-results/choreography-fan-*.png`. All 83 unrelated starting-file hashes still match. V1/V2 remain unchanged. Real-phone GPU/battery and cross-browser performance remain unmeasured; this is not a universal frame-rate guarantee.


### Sculpture revision deployment

- Sculpture version: `6e9fdd41-d04a-428a-9375-ff9e7f0d7657` (superseded by the midnight direction below).
- Previous version / rollback reference: `e50904e6-bfe0-49a8-9840-3fec22a131d2`.
- Published through the existing authorized V3-only Wrangler command. Live HTTP references the tested `index-Hwowp8_q.js` and `index-2uc06_CS.css` assets.
- The local Worker remains available on port 8792 because the user's browser is open there. Live URL: https://bullshit-poker-v3.every-day.workers.dev/ .
- Changes remain uncommitted; no V1/V2 deployment or unrelated file modifications.

- Final live Chrome verification: **4/4 passed** in 17.9 seconds (animation/replay/pause/Reduced Motion, phone entry, desktop entry, disposable room create/permanent-leave). Log: `/tmp/poker-v3-choreography-live.log`.


## September 11 midnight art direction and replay polish

On the user's renewed request to continue redesigning the main page, moved the minimal-copy entry to a dark stage: navy/ink background, soft blue ambient light, bright paper faces in the fan, a luminous grid, and yellow Create action. Removed text stays absent. All theme overrides are scoped to `.entry-shell`; game, lobby and V1/V2 styles are preserved.

Added a shallow travelling wave across fan layers while keeping the full animated envelope in frame. Face textures are generated once and disposed with the scene. Found and fixed a real replay discontinuity: resetting the fan timer also reset the deck's vertical float/roll. Ambient orbit and lift now use an independent clock, and tests cover replay at multiple cycle positions. Motion is still paused offscreen, during entry forms and in Reduced Effects.

`npm run check` passed TypeScript, lint, **171/171** unit/integration tests and build. Geometry tests include the added wave. All 83 unrelated starting-file hashes match. Logs: `/tmp/poker-v3-midnight-check.log`, `/tmp/poker-v3-midnight-ui.log`. Final browser/deployment evidence follows.

A pre-redesign Chrome baseline sampled 180 requestAnimationFrame intervals each at 390×844/DPR3 and 1440×900/DPR2: median 16.7ms, p95 16.8ms, zero intervals over 34ms. This measures callback pacing on this desktop host, not physical phone performance or GPU presentation latency. No universal FPS guarantee is claimed.


### Midnight release verification

- Full browser suite: **27/27 passed** (about 1.3 minutes). No build/lint/typecheck/test failures.
- Final design frame-pacing sample matched the baseline: 180 intervals per configuration, median 16.7ms, p95 16.8ms, no intervals above 34ms. Artifact: `/tmp/poker-v3-midnight-frame-pacing.json`. Same desktop-Chrome/physical-device limitations apply.
- Midnight V3 version: **`7491addf-4716-4826-8595-79a407a1a0f0`** (superseded below).
- Previous version / rollback reference: `6e9fdd41-d04a-428a-9375-ff9e7f0d7657`.
- Published through the existing V3-only authorization. Live HTTP matches `index-B8t6Kk0f.js` and `index-BXLP9D8J.css`. Local port 8792 remains available for the user's open preview.
- V1/V2 and all 83 unrelated starting files remain preserved. Changes are uncommitted.

- Final live Chrome verification: **4/4 passed** in 17.5 seconds (animation/replay/motion preferences, phone and desktop entry, disposable-room smoke). Log: `/tmp/poker-v3-midnight-live.log`.


## September 11 continuous animation and compact entry panels

Latest user instructions: keep the darker direction, remove Replay, keep the background animation running during Create Table/Join Room, remove “Identity channel,” and improve the design. These instructions supersede the earlier replay and pause-during-form requirements recorded above.

Verified causes and changes:

- Entry explicitly passed `paused={railOpen}` to the scene. Removed that API and its playback refs/effects, plus the replay button/state/props and replay-only clock/blending code. One continuous 16-second clock now drives the sculpture. Hidden/offscreen/context-loss and reduced-motion protections remain.
- “Identity channel” was a `.deal-rail::before` CSS badge. Removed its rule entirely, along with all replay CSS.
- Four tapered diamond wakes now sample previous positions along each card's own orbit, replacing unrelated elliptical streams. Still one instanced draw (12 balanced/24 full). A pale inner ring and slow complementary lighting improve depth against the approved dark background.
- Replaced the full-height rail with a compact dark gradient panel. On desktop it occupies the title column, leaving the sculpture unobstructed; on phones the panel sits above the bottom safe area and the artwork moves upward. Short viewports scroll inside the panel. Improved focused-input and placeholder contrast.
- No new dependencies or game/server changes. Updated the current specification; historical entries above remain as prior-release evidence.

Validation in progress: TypeScript, lint, **171/171** unit/integration tests and build passed (`/tmp/poker-v3-orbit-check.log`). Numerical coverage verifies trail taper/path/bounds and retains full-cycle card/camera checks. The first browser run passed 27/28; its sole failure was an obsolete assertion requiring the old full-height desktop panel. Updated that assertion to require the new bounded compact panel, and added a regression proving the desktop panel cannot overlap the artwork. Final full browser and deployment results follow below. All 83 unrelated baseline-file hashes match.


Final local validation: **28/28 Chrome browser tests passed** in about 1.4 minutes (`/tmp/poker-v3-orbit-final-ui.log`). Entry checks prove frames keep changing behind both forms, offscreen suspension still works, reduced motion stays static, and replay/badge are absent. Four form viewport sizes include narrow phones, landscape and desktop; eight entry sizes retain their containment checks. Existing full create/join/PIN, invite, room lifecycle, reconnect, reaction, overlay, fallback, context-loss and ten-seat tests pass. Re-ran TypeScript and lint after final test edits; both pass. Formatting and `git diff --check` also pass.

Visually reviewed `v3/test-results/choreography-fan-desktop.png`, `entry-panel-Create-Table-1440.png`, `entry-panel-Join-Room-390.png` and `entry-panel-Join-Room-844.png`. Physical-phone performance, virtual keyboards and non-Chrome engines remain unmeasured; viewport emulation does not establish those results. Production publication and smoke evidence follow.


### Continuous sculpture deployment

- Continuous sculpture version: **`47c993cc-7557-4c75-b75b-8a0735e4729c`** (superseded by the oval lobby below).
- Previous version / rollback reference: `7491addf-4716-4826-8595-79a407a1a0f0`.
- Published using the existing V3-only authorization; Wrangler log: `/tmp/poker-v3-orbit-deploy.log`.
- Live HTTP references the tested `index-CcjUC8SM.js` and `index-gkYGFk51.css` assets.
- Local preview remains on port 8792. V1/V2 and unrelated changes are preserved. Work remains uncommitted.

- Final live Chrome verification: **5/5 passed** in 22 seconds (continuous animation through Create/Join, compact unobstructed panels, phone/desktop entry steps, reduced motion and disposable-room create/leave). Log: `/tmp/poker-v3-orbit-live.log`. No remaining implementation work identified within this follow-up scope; physical-device/other-browser validation limits remain as documented.


## September 11 oval lobby and names on the table

User asked to improve the lobby, then requested name-only labels at 3D seats. After reviewing the first local iteration, explicitly requested clearer alignment, recognizable playing cards instead of an abstract animated stack, one invite action, the earlier compact player-list layout, and an oval table. Those corrections supersede the initial card-list/guide-line/fanning-stack design.

Final implementation:

- Dark lobby with an oval 3D tabletop, elliptical rim and center marking. Uses a separate lobby camera envelope; game table geometry/framing stays unchanged.
- Small name-only plates stay centered directly beneath projected seat markers. Text stays upright, scales for readability, and moves only when needed to resolve collisions. No long guide lines. Long narrow-screen names ellipsize on the table; the roster shows the full wrapped name.
- Three recognizable face-up decorative playing cards replace the abstract stack. These are lobby artwork, not dealt hands; no private game information is fabricated or exposed. No continuous stack animation.
- Restored the earlier light, ruled player list with diamond markers, identity text, readiness aligned on the right and host removal controls. One roster; the second full duplicate list remains removed.
- One Invite friends action opens the existing share dialog; the lobby top-bar share duplicate is removed. Game-page sharing remains unchanged.
- Accessible readiness progress now derives from authoritative ready/connected players and bots, replacing the fixed 55% bar. Existing start/host/connection gates are preserved.
- Visible mobile Deal/Add Bot labels and 44px touch targets. Reduced motion and WebGL fallback remain usable. Labels rebuild on authoritative joins/leaves, resize and WebGL restoration.

Validation: **172/172** unit/integration tests, TypeScript, lint and build passed. Added numerical label containment/collision checks for 1–10 seats, four scene sizes and extreme pointer tilts. Full Chrome browser suite **29/29 passed** in about 1.5 minutes (`/tmp/poker-v3-oval-ui.log`). Added browser coverage for label/roster mapping, accurate readiness progress, one invite action, focus restoration and removal. Existing 1–10-player viewport and long-name collision checks now include table labels.

Visually inspected ten-seat phone and desktop screenshots (`v3/test-results/oval-lobby-ten-mobile.png`, `oval-lobby-ten-desktop.png`). Final label-font adjustment and deployment verification follow below. Physical-phone GPU/keyboard behavior and Safari/Firefox remain unmeasured. V1/V2 and unrelated changes remain protected.


Final local follow-up: TypeScript, lint, **172/172** unit/integration tests and build passed (`/tmp/poker-v3-oval-final-check.log`). The final typography adjustment passed all **8/8** affected browser checks (`/tmp/poker-v3-oval-final-ui.log`), including full lobby lifecycle, WebGL rejection, 1–10 seats across phone/tablet/desktop, six long human names and ten-seat reveal. The label geometry test also passed after tightening it to the final 20px plate height. Formatting and diff whitespace checks pass. All 83 protected baseline-file hashes match.


### Oval lobby deployment

- Oval lobby version: **`a2e1d4b8-4207-4dfe-b3bf-a5b0120936d8`** (superseded by the classic main-page release below).
- Previous version / rollback reference: `47c993cc-7557-4c75-b75b-8a0735e4729c`.
- Published through the existing V3-only authorization. Wrangler log: `/tmp/poker-v3-oval-deploy.log`.
- Live HTML references the tested `index-C1hyg5u_.js` and `index-2YRCtnZT.css` assets.
- Local preview remains available on port 8792. Changes are uncommitted. No V1/V2 deployment or unrelated edits.

- Final live Chrome verification: **4/4 passed** in 17.5 seconds (names/readiness/invite focus, desktop lobby, 1–10-seat phone/tablet/desktop collision checks and disposable-room smoke). Log: `/tmp/poker-v3-oval-live.log`. No known unfinished implementation within the requested lobby corrections; physical-device and other-browser limitations remain documented above.


## September 12 classic main page with V3 animation and actions

User requested the older main-page appearance shown in their screenshot, with the current V3 animation in the center and current V3 Create/Join buttons. This supersedes the prior split-title/sculpture main-page layout. The oval lobby and game interfaces remain unchanged.

Reused the exact existing `kinetic-cardroom-launch-wide-v2.webp` background and its phone variant. Restored the centered gradient BullShit title, white Poker title, Live social bluffing indicator and “The table remembers. Bluff accordingly.” tagline. Added decorative edge cards on wide screens to preserve the reference composition; these are hidden on narrow screens. The current V3 scene, eased choreography, pointer response, reduced motion and fallback remain intact in a bounded center stage. Existing V3 yellow/dark Create/Join actions sit at the bottom and open the same compact forms. No replay or extra explanatory copy reintroduced.

Validation in progress: TypeScript/lint, **172/172** unit/integration tests and build passed (`/tmp/poker-v3-classic-check.log`). The first browser run exposed a height constraint that could put desktop actions at the viewport edge; adjusted the stage to use the available grid height. Final results follow. All 83 unrelated baseline files still match their preserved hashes.


Final local verification: all **7/7** affected browser checks passed (`/tmp/poker-v3-classic-final-ui.log`, 33.2 seconds), including eight responsive sizes, centered animation, continuous Create/Join animation, reduced motion, offscreen suspension, form placement, WebGL fallback and disposable-room smoke. The prior full run passed the other 28 tests; its only failure was the now-corrected desktop height constraint. Final build and `git diff --check` pass. Visually reviewed 390×844 and 1440×900 entry screenshots. Physical-device and other-browser limitations remain unchanged.


### Classic main-page deployment

- Classic main-page version: **`fd52b4ef-476e-47bc-9379-e9798cbe861c`** (superseded by the outer-card motion update below).
- Previous version / rollback reference: `a2e1d4b8-4207-4dfe-b3bf-a5b0120936d8`.
- Published using existing V3-only authorization. Log: `/tmp/poker-v3-classic-deploy.log`.
- Live HTML references the tested `index-DvfZwTk5.js` and `index-CF65MM3m.css` assets.
- Local preview stays on port 8792. Oval lobby/game behavior and V1/V2 are preserved; work remains uncommitted.

- Final live verification: **5/5 Chrome tests passed** in 29.3 seconds, covering the eight-size classic composition, animation/motion preferences, mobile/desktop entry and disposable-room smoke. Log: `/tmp/poker-v3-classic-live.log`. No unfinished implementation identified within this main-page request; physical-device/cross-browser limits remain documented.


## September 12 outer-card motion and gradient actions

User clarified that all four outer cards must animate like the older version, then explicitly requested that the four cards also appear and move on mobile. Create/Join colors should match the title's current cyan/violet/pink gradient palette.

- Added staggered 12-second compositor-transform loops with vertical drift and gentle perspective/rotation on all four outer cards. Original resting angles remain; reduced-motion and Reduced Effects remove the animations.
- Mobile/tablet outer cards are now shown at smaller sizes with restrained corner placement. Insets account for their rotated bounds; top and bottom offsets keep them between the heading and actions. Center sculpture behavior is unchanged.
- Create uses cyan-to-violet and Join violet-to-pink, with dark readable text and matching hover gradients. Buttons are separated by a small gap and retain the existing entry behavior.
- Added browser assertions that every outer card changes pose on both phone and desktop, all remain still under system reduced motion, and mobile/tablet cards stay inside the viewport and clear of title/actions.

TypeScript, lint, **172/172** unit/integration tests and build passed (`/tmp/poker-v3-edge-final-check.log`). Browser/visual and deployment evidence follows. Changes are scoped to the main-page CSS and its browser coverage; lobby/game behavior and V1/V2 are preserved.

Final local browser verification: **7/7 passed** in 35.7 seconds (`/tmp/poker-v3-edge-ui.log`), including eight viewport sizes, all-four-card motion on phone and desktop, reduced motion, fallback, compact forms and room smoke. Visually reviewed 390×844 and 1440×900 screenshots. All 83 protected baseline hashes still match; diff whitespace checks pass. Physical-device/cross-browser performance limits remain unchanged.


### Outer-card motion deployment

- Current V3 version: **`09bad4d4-828c-4edd-a653-36da0946bb30`**.
- Previous version / rollback reference: `fd52b4ef-476e-47bc-9379-e9798cbe861c`.
- Published through the existing V3-only authorization. Log: `/tmp/poker-v3-edge-deploy.log`.
- Live HTML references the tested `index-AMkZ7Oq4.js` and `index-UzxPFc4O.css` assets.
- Local preview stays on port 8792; lobby/game and V1/V2 remain unchanged. Work is uncommitted.

- Final live Chrome verification: **5/5 passed** in 31 seconds (`/tmp/poker-v3-edge-live.log`), including phone/desktop outer-card motion, reduced motion, eight viewport sizes, entry flows and disposable-room smoke. No unfinished work identified in this follow-up scope.

## September 13 classic lobby restoration

Latest user direction: build the lobby on the older version's conventions, retaining an oval table and adding animation. Inspected the older lobby in `v2/src/client/App.tsx` and `v2/src/client/styles.css`; adapted its presentation into V3 without importing old state handlers or changing V1/V2.

- Restored “Table assembling / Every seat has a tell.”, cyan/lilac/pink palette, unframed table and compact ruled roster with diamond markers. Wide desktop uses introduction/table/roster columns; intermediate widths use two columns and phones stack the zones. The roster now uses the classic dark palette, superseding the earlier light panel.
- Retained oval geometry, projected name-only labels, recognizable face-up center cards, one invitation action, real readiness progress, readable mobile controls and authoritative action gating.
- Added slow light travel around the oval and short player-arrival motion. Existing gentle seat motion remains; all stop under reduced-motion preferences. Game-scene lighting/colors remain scoped separately.
- Main-page composition, V1/V2 and unrelated dirty work were not edited this turn. The earlier `/tmp/poker-v3-recovery-start-hashes.json` baseline is no longer accessible, so its 83-file hash comparison could not be repeated. No reset, checkout or commit performed.

Validation: typecheck, lint, **172/172** state tests and build passed (`/tmp/poker-v3-classic-lobby-check.log`). Full Chrome browser suite **29/29 passed** in 1.1 minutes (`/tmp/poker-v3-classic-lobby-ui.log`), including 1–10 seats, long names, mobile/tablet/desktop, invites, readiness/start, reconnect, overlays, WebGL fallback and gameplay. An added lobby-specific check verifies moving canvas frames normally and identical frames plus no roster animation under system reduced motion; **1/1 passed** (`/tmp/poker-v3-classic-lobby-motion.log`). `git diff --check` passed. Screenshots reviewed for wide desktop and narrow mobile. Physical-device and other-browser performance remain unmeasured.

Deployment is unfinished: automatic approval review rejected the direct V3 Wrangler deployment on September 13, stating that this latest request authorized building the lobby but did not authorize publishing this payload to the remote Worker. The deployment command did not execute. Live remains version **09bad4d4-828c-4edd-a653-36da0946bb30**; the new build is available on local port 8792. Next step: obtain explicit approval for this update's V3 publication, deploy the verified build, run live lobby smoke and record its version/rollback. No attempt was made to bypass the rejection.


## October 18 GitHub complete-workspace snapshot

User requested GitHub publication of all versions on a side branch. Verified repository `jaswanth9699/bullshit-poker` and live remote refs: `main` is the V1 baseline at `dcd3430ac7eab9d92f250fb007a6b3ea700ccb35`; existing `codex/v3` is at `a3da359a17dfe7ddcb35b74638eba9581cb4c797`. Created `codex/all-versions` from that V3 history to preserve the entire current source workspace: root legacy changes, complete V2, latest V3, tests, assets, specs and this handoff. Main and the old V3 branch remain unchanged. README documents the version locations and the existing root/V2 Worker-name swap; configuration was not changed.

Fresh validation: root legacy typecheck, **107/107 tests**, build; V2 typecheck, lint, **135/135 tests**, build; V3 typecheck, lint, **172/172 tests**, build all passed. Logs: `/tmp/poker-github-{legacy,v2,v3}-check.log`. Existing Vite chunk-size warnings remain. Browser checks were not rerun for this source-publication task; the September results above are historical. Dependencies, build output, local Worker state, credentials and test artifacts remain ignored. This task publishes Git source only; the September V3 Worker deployment remains pending.
