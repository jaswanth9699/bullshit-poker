# BullShit Poker V3 Specification

Status: V3 reliability/responsive recovery validated and deployed to the isolated V3 Worker with user approval (see `POKER_V3_HANDOFF.md`)
Working branch: `codex/v3`  
Development Worker: `bullshit-poker-v3`  
Development URL: `https://bullshit-poker-v3.every-day.workers.dev/`  
Active V3 deployment version: `09bad4d4-828c-4edd-a653-36da0946bb30`
Previous V3 version / rollback reference: `fd52b4ef-476e-47bc-9379-e9798cbe861c`
Protected production URLs: `bullshit-poker.every-day.workers.dev` and `bullshit-poker-v2.every-day.workers.dev`

### September 12 classic main-page composition (current)

- Restore the original cardroom background, centered gradient/white title, indicator, tagline and wide-screen edge-card composition shown in the user's reference.
- Animate all four outer cards with staggered floating/tilting motion on desktop and mobile. Scale/inset them to avoid title/action collisions; Reduced Effects/system Reduced Motion keep them still.
- Use cyan-to-violet Create and violet-to-pink Join gradients with dark readable text.
- Keep the current V3 animated sculpture in the center and the V3 Create/Join buttons at the bottom. Fit the stage between heading and actions on normal phone/desktop heights; short landscape layouts may scroll.
- Preserve the V3 entry forms, automatic connection behavior, continuous animation during entry, reduced motion and fallback. Keep replay and explanatory paragraphs absent.
- This supersedes the earlier split-column main-page composition. Preserve the oval lobby, game/winner interfaces and V1/V2.

### September 13 classic lobby composition (current)

- Build on the older lobby's cyan/lilac/pink convention: introduction, centered oval table, compact ruled player manifest. Wide screens use three columns; intermediate widths use two and phones stack the zones.
- Keep the diamond roster markers, clear readiness labels, full player names and host controls. Match the roster to the restored dark palette, superseding its September 11 light background.
- Add slow lighting that travels around the oval, gentle seat motion and a short roster arrival transition. Honor Reduced Effects and system reduced motion.
- Preserve the small seat-aligned names, recognizable center playing cards, single invite action and authoritative lobby behavior. Do not alter the main page or game table.

### September 11 oval lobby and table names (geometry and behavior retained)

- Use a dark lobby with an oval 3D table and a separate containment envelope. Keep the game table geometry unchanged.
- Show small, upright names directly beneath each projected seat, resolving actual collisions without distant guide lines. Full names remain in the roster when narrow table labels ellipsize.
- Show recognizable decorative face-up cards in the center, replacing the abstract animated stack. These are artwork, not a dealt hand.
- Restore the earlier ruled player list with diamond markers, aligned readiness labels and host removal controls. Keep one full roster; its palette follows the September 13 update above.
- Keep one Invite friends action, accessible readiness progress derived from room state, visible mobile action labels and existing authority gates.
- Preserve reduced motion, WebGL fallback, game/winner interfaces and all V1/V2 behavior.

### September 11 continuous midnight sculpture (composition superseded above)

This user-approved follow-up supersedes the earlier replay control and pause-during-entry behavior.

- Keep the ink/navy stage, soft blue ambient light, bright paper fan faces, minimal title/kicker/tagline and yellow Create action. Remove Replay and the CSS-generated “Identity channel” badge entirely.
- Run the eased 16-second unfolding, suspended wave and gathering cycle continuously through Create Table and Join Room, including name/PIN entry. Pause only for hidden tabs, offscreen artwork, context loss or Reduced Effects/system Reduced Motion.
- Four tapered diamond wakes follow the actual orbital card paths in one instanced draw. Slow complementary lighting reveals deck edges, with a pale inner arc visible against the dark stage. Full motion stays within the camera bounds.
- Desktop forms replace the title column with a compact illuminated panel, leaving the sculpture unobstructed. Phones use an inset bottom panel and move the artwork up when entering. Form content scrolls within short viewports.
- Reduced Effects/system Reduced Motion use a fixed open fan; WebGL fallback stays playable. Pointer response remains local and smoothly damped. No explanatory paragraphs, replay/reset controls or automatic full-screen reveal.
- Preserve first-screen phone actions, accessible entry fields and existing create/join/PIN behavior. No gameplay, server authority, lobby/game theme or V1/V2 changes.

### September 10 entry composition redesign (superseded)

- Use a compact poker-club masthead, strong title hierarchy, short game introduction, live card poster, prominent Create/Join actions, and a three-step rules guide.
- On phones the headline, artwork and actions occupy consecutive zones with small explicit gaps. Both action buttons must fit within the initial viewport at 320×760 through 430×932.
- On desktop use a split text/art composition with a full-width rules strip. No artwork/text overlap; short landscape viewports may scroll normally.
- The entry camera centers the full scene in its dedicated stage, with a larger deck and tighter orbit composition. Reduced Effects stays static; WebGL fallback shows a CSS card illustration.
- Existing entry language, create/join/PIN steps, invite handling, server rules and game scenes remain unchanged.

### September 10 animation clarity correction

- Entry cards and orbit accents retain their original colors without foreground fog. Phone composition is centered and antialiased.
- Table framing fits the platform, seat markers and animated claim fan with breathing room; scene zones provide enough height for readable cards on phone and desktop.
- Table edges use visible mesh rails. Larger claim faces stay pointed at the viewer with bounded sway; they never continuously spin edge-on or backwards.
- BullShit resolution has a short, visible expanding ring alongside the existing nonblocking result notification. It does not delay the next round.
- Reduced Effects stops motion while retaining full scene contrast and readable card faces.
- Automated checks cover high-DPI rendering, five-card readability/framing over time, narrow phones, desktop, and static Reduced Effects. Real-device frame time and cross-browser validation remain open.

### Approved September 8 reliability and responsive update

The recovered user approval supersedes earlier review-delay and manual reconnect descriptions:

- Round resolution, complete frozen reveal, and immediate redeal form one serialized persisted transition. Legacy stored review-phase rooms recover when a player reconnects.
- No next-round button/countdown or automatic blocking reveal. A brief nonblocking result notice appears; complete hands are available through deliberate Last Round/Final Reveal access.
- Reactions expire three seconds after receipt. A newer reaction replaces the previous one; reconnect snapshots do not replay old effects.
- Reconnection runs automatically in the background. No manual reconnect/refresh buttons. Only a server-accepted current connection can issue gameplay commands; replaced tabs relinquish the seat.
- Invite links honor their own room instead of restoring another room's saved seat. Overlays are mutually exclusive, keyboard accessible, and invalidated when their authoritative action window changes.
- Mobile uses separate turn, scene, timeline, action, and hand zones. Both scene cameras fit their full bounds to actual container dimensions. Remove intersecting decorative rails and `LIVE TABLE / 03` / `Private channel`; entry language uses `Live social bluffing`, `Start fresh`, and `Lock onto a room`.
- The audit and checks cover race safety, reconnect/leave, malformed/stale/duplicate commands, accessibility, long content, responsive layouts and renderer fallback. Current evidence and remaining roadmap work are recorded in `POKER_V3_HANDOFF.md`.

## 1. Product Thesis

BullShit Poker V3 is a live bluff broadcast expressed as an interactive spatial instrument. It deliberately abandons the dark panel-and-card-dashboard structure of V1/V2: every mode has its own composition, while one graphic system makes the whole product recognizable.

- The launch screen is a full-bleed deck reactor with oversized editorial identity and a two-command entry gate.
- The lobby is an assembly field: player signals surround an angular table platform and a precise manifest replaces overlapping circular labels.
- The game is one continuous black arena, with a player transmission rail above it and the private hand isolated below it.
- Claims materialize as physical constructions inside an angular Three.js network rather than behind a conventional dashboard.
- BullShit, reveal, penalty, reactions, connection changes, and round changes create concise visual events without delaying authoritative state.
- Mobile is a native composition, not a scaled desktop view. It retains the complete Three.js world, touch-sized controls, safe-area handling, and readable ten-player states.
- Reduced Effects and renderer fallback are first-class playable modes.

## 2. Reference Audit

The design and technical study covers Bruno Simon's current interactive portfolio, its HTML project archive, and the public source repository:

- Portfolio: <https://bruno-simon.com/>
- Project archive: <https://bruno-simon.com/html/>
- Public source: <https://github.com/brunosimon/folio-2025>
- Three.js Journey project index: <https://threejs-journey.com/>

The reference is useful for engineering principles, not for copying its vehicle, map, models, sounds, layout, or visual identity.

### 2.1 Observed Interaction Principles

- The 3D world is the primary experience rather than a background behind conventional panels.
- Input is unified across keyboard, pointer, touch, and gamepad.
- Mobile controls are designed for touch instead of being a reduced desktop layout.
- Conventional menu, map, quality, mute, respawn, and accessibility controls remain directly available.
- Progress, achievements, environmental states, audio, and physical feedback make the world feel persistent.
- Interactions have clear anticipation, action, reaction, and recovery phases.

### 2.2 Observed Engineering Principles

- A prioritized frame loop separates input, pre-physics, physics, post-physics, world updates, view updates, and rendering.
- A minimal first scene loads before heavier models, textures, physics, and secondary effects.
- Renderer quality adapts by device and user selection.
- Three.js uses a WebGPU renderer with WebGL fallback.
- Delta time is clamped so a suspended tab cannot create a destructive simulation jump.
- Models and textures are compressed, and UI assets use efficient web formats.
- Gameplay systems are modular: input, camera, physics, world, audio, achievements, interface, resources, and quality.

## 3. Non-Negotiable Compatibility Contract

- V3 inherits the tested V2 game engine and locked BullShit Poker rules.
- Claim order, claim validation, final-claim behavior, BullShit races, penalties, elimination, starter rotation, bots, reconnection, leave flow, rematch, and winner logic do not change as a consequence of visual work.
- Durable Objects remain the source of truth.
- Three.js, animation, sound, haptics, and local input never commit game state.
- Every actionable 3D element has an equivalent semantic HTML control.
- A failed or unsupported 3D renderer must leave a fully playable game.
- V3 never deploys to either protected production Worker until the user explicitly approves promotion.
- V3 uses a fresh Durable Object class and namespace. It cannot read or mutate V1/V2 rooms.

## 4. V3 Visual Direction

### 4.1 Graphic World

The world combines a cold-white editorial field with a near-black carbon arena. Cobalt blue carries structure and interaction, signal orange carries tension, electric yellow carries current/selected state, and true playing-card red is reserved for hearts, diamonds, and destructive emphasis. This is neither casino luxury, comic-brutalist parody, nor the cyan/purple glass styling of V1/V2.

The visual grammar is angular and diagrammatic:

- hard divisions instead of stacked floating cards;
- clipped corners and diamonds instead of generic rounded pills;
- large typography used only for the current story or action;
- indexed controls and coordinate labels that make screens feel like a live instrument;
- grid lines, signal rails, and physical nodes that express state rather than decorate empty space;
- color-independent labels and icons for every semantic state.

No spatial object may make a claim, player name, card, or primary action harder to read. Private cards remain crisp semantic HTML above the rendered world.

### 4.2 Signature Objects

**Deck Reactor:** The launch world is built procedurally from real Three.js geometry and generated card textures. A layered BULL / SHIT deck, orbit rails, signal bars, rank satellites, and perspective grid react within restrained camera limits on desktop and mobile.

**Signal Platform:** Lobby and live play use an angular, hexagonal network rather than a circular poker table. Seat beacons, edge paths, and a center claim formation are synchronized from authoritative room state.

**Claim Core:** The current claim is represented by a compact physical construction at table center:

- High Card: one upright card plane.
- Pair through Four of a Kind: grouped card silhouettes with rank glyphs.
- Straight and Straight Flush: a rising ribbon of five card planes.
- Flush: a five-card fan with a suit light channel.
- Full House: a three-card block interlocked with a two-card block.
- Royal Flush: a restrained crown-like formation using five real card planes, never a generic crown icon.

The semantic claim text remains visible beside or beneath the object at all times.

### 4.3 Motion Language

- **Deal:** cards move from the table core to seats along shallow arcs with staggered arrival.
- **Claim:** selected rank/suit components snap together, compress, then settle at center.
- **Response window:** the network carries restrained motion; the semantic action zone remains still.
- **BullShit:** the table contracts for 120-180 ms, emits a radial light impulse, and separates the claimed formation.
- **Reveal:** physical cards turn in deterministic seat order, then the proof hand is highlighted.
- **Penalty:** one card travels to the penalized seat after the truth result is readable.
- **Elimination:** the seat light closes and the seat recedes without making the player disappear from history.
- **Winner:** the result becomes a full-screen broadcast state; the surviving signal connects to the table core.
- **Reconnect:** the camera does not replay historical events; the scene assembles directly into current state.

Motion is short, interruptible, and subordinate to input. The latest authoritative state always wins. Reduced Effects stops continuous rendering and transitions immediately to stable frames.

## 5. Screen Design

### 5.1 Entry: Deck Reactor

- A full-bleed procedural deck reactor renders on mobile and desktop.
- `BULLSHIT / POKER` is an oversized first-viewport identity, not text inside a card.
- Create Table and Join Room are the only initial commands and sit in a flat two-channel gate.
- Selecting a command opens the Deal-In Rail: a full-height desktop identity channel or bottom mobile input rail, leaving the world visible.
- Fields advance one at a time with Back, Close, and direct submit controls; no modal form card covers the scene.
- PIN inputs remain text fields with numeric input semantics and CSS masking, preventing password-manager classification while keeping digits private.
- Loading, reduced effects, or failure of the 3D layer never blocks the entry controls.

### 5.2 Lobby: Signal Assembly

- The lobby is an unframed assembly composition, not a lobby card.
- An angular Three.js signal platform carries synchronized human, bot, ready, offline, and open-seat beacons.
- Player names live in a collision-proof numbered signal matrix rather than on a fragile radial orbit.
- A separate Signal Manifest provides full names, statuses, host identity, and host-only remove controls.
- Ready, Add Bot, and Deal the Table remain in a stable command dock; share, settings, end game, connection status, copy, and leave remain in the room strip. Reconnection is automatic.
- Two, six, and ten seats are independently verified at 320 px mobile, 390 px mobile, tablet, laptop, and mobile landscape sizes.

### 5.3 Live Game: Bluff Arena

- Desktop uses one continuous full-width arena instead of a dashboard/sidebar composition.
- Mobile uses the same world in a vertical broadcast layout, with the complete Three.js scene correctly framed rather than hidden or replaced.
- A horizontally scrollable player transmission rail guarantees full names and states without collisions at ten players.
- The current turn is the visual headline; previous claim, round, phase, latest claim, and actions form a strict secondary hierarchy.
- Current turn, previous claim, round starter, card count, connection state, and phase remain visible without opening a panel.
- The player's hand is a separate full-width private channel with stable card dimensions and no ambient animation.
- Primary actions stay together across mobile portrait, landscape, and desktop; reactions open from a compact edge trigger.

### 5.4 Claim Forge

- Claim Forge is a full-screen application mode, not a bottom sheet or nested card.
- Desktop uses a black category rail, oversized claim construction, and structured control lane.
- Mobile uses a horizontally scrollable category rail and a compact top-packed preview/select/submit sequence.
- Only legal higher rank/suit choices are offered.
- A high-contrast construction preview responds immediately as legal options change.
- Submit uses the existing authoritative command and stale-revision handling.
- The preview is discarded immediately if server state advances.

### 5.5 Reveal and Last Round

- Reveal is a manually opened full-screen proof mode with a fixed truth headline, caller, claimant, and complete frozen hands. Immediate next-round play is accompanied by a nonblocking result notice.
- Cards turn with actual red hearts/diamonds and dark spades/clubs.
- The proof highlight explains which cards satisfy or fail the claim.
- Last Round owns its viewport and scroll container, with a sticky close control and safe bottom padding.
- Every player's complete frozen hand remains visible; no clipping or horizontal-only dependency.
- The inspected result stays fixed while later live rounds advance; reopening selects the latest completed result.
- Reduced Effects reveals immediately without motion.

### 5.6 Result and Rematch

- Results occupy the complete viewport as a decisive broadcast state rather than a generic celebration card.
- Match summary, rematch readiness, leave, and host controls remain explicit HTML actions.
- Rematch resets visual event history before the new match revision is consumed.

### 5.7 Complete V3 Interface Composition

- V3 imports one dedicated visual system. No V1/V2 stylesheet participates in its cascade.
- The shared room header is a flat command strip with a compact connection signal, room code, card total, copy, share, settings, host end-game, and leave actions. Reconnection is automatic.
- Entry, lobby, game, Claim Forge, reveal, settings, sharing, reactions, confirmation, and results each use a purpose-built full-screen or unframed composition.
- The lobby uses a static signal matrix plus a semantic manifest; it never places long names on collision-prone radial coordinates.
- The live game uses a horizontal player transmission rail, one full-width spatial arena, and a full-width private-hand shelf.
- Full-screen modes own their viewport and internal scrolling, preventing intrinsic content from expanding or clipping the page.
- Hearts and diamonds use true card red; semantic state never depends on color alone.
- Portrait mobile, narrow mobile, tablet, laptop, and mobile landscape have dedicated layout verification. No V3 screen depends on desktop-only Three.js framing.
- The authoritative game and network contracts remain unchanged beneath the replacement presentation layer.

## 6. Input Model

### 6.1 Mobile

- Tap: select a seat, claim object, or direct control.
- One-finger drag outside controls: shallow table orbit with strict angle limits.
- Two-finger pinch: optional scene zoom within a narrow safe range.
- Device tilt: opt-in only, low amplitude, and disabled by Reduced Effects.
- Long press is never required for a game action.
- All targets are at least 44 by 44 CSS pixels.
- Browser Back invokes the existing safe leave flow, not an immediate leave.

### 6.2 Desktop

- Pointer drag: shallow orbit.
- Wheel: narrow safe zoom range when the pointer is over the scene.
- Keyboard focus and shortcuts operate semantic controls, not hidden canvas hit targets.
- Escape closes the topmost non-destructive sheet/dialog.

### 6.3 Accessibility

- Scene canvas is decorative to assistive technology unless a specific semantic description is needed.
- Turn, claim, reveal, caller, penalty, elimination, connection, and winner changes are announced through controlled live regions.
- Focus never moves because a 3D animation starts.
- High contrast and color-independent state signals are required.
- Reduced Effects, mute, and haptics preferences persist independently.

## 7. Rendering Architecture

### 7.1 Layering

```text
Authoritative room state
        |
Revision-aware visual event adapter
        |
Scene state machine and interruptible event queue
        |
Three.js renderer + semantic React interface
```

- React owns routes, controls, cards, text, dialogs, sheets, and accessibility.
- Three.js owns the table world, camera, seat forms, claim core, lighting, and effects.
- The visual adapter derives events from successive private room views.
- Events are keyed by `matchId`, `roundNumber`, state revision, and event type.
- Duplicate revisions and reconnect snapshots cannot replay completed effects.
- A newer state may cancel or fast-forward any older visual sequence.

### 7.2 Renderer

- Use a quality-aware WebGL renderer with capped device-pixel ratio and lazy scene bundles.
- Fall back to a static CSS/bitmap table if renderer initialization or context recovery fails.
- WebGL/WebGPU context loss shows no blocking error and does not disconnect the room socket.
- Continuous rendering stops when the scene is settled, the tab is hidden, or Reduced Effects is enabled.
- Frame delta is clamped before any visual simulation.

### 7.3 Animation and Physics

- Use direct Three.js animation for deterministic state transitions.
- Add Rapier only for isolated cosmetic card scatter or chip reactions where it visibly improves quality.
- Physics bodies cannot represent authoritative cards, player position, claims, or penalties.
- Seed cosmetic simulations by authoritative event ID so reconnect tests can reproduce them.
- Every physics sequence has a fixed timeout and deterministic settled end state.

### 7.4 Asset Pipeline

- GLB models are geometry-compressed and texture-compressed.
- KTX2/Basis textures are preferred for world materials.
- Interface imagery remains WebP/AVIF with explicit dimensions.
- Large environment resources are dynamically imported after the playable shell.
- No essential text is baked into a texture.
- Every asset has ownership/license metadata.

## 8. Quality Profiles

### 8.1 Full

- WebGPU/WebGL, adaptive DPR up to 1.75, selective bloom, soft shadows, physical scatter, richer particles, environment reflections.

### 8.2 Balanced

- Default on modern phones and lower-power laptops.
- DPR capped at 1.25, reduced particles, simplified shadows/reflections, no depth-of-field effect.

### 8.3 Reduced

- Static camera, no continuous particles, no physical scatter, no device tilt, instant state transitions, DPR capped at 1.0.
- This profile is automatically selected by `prefers-reduced-motion` but may be overridden by the user.

### 8.4 Automatic Adaptation

- Initial profile considers viewport, device memory when exposed, renderer support, and reduced-motion preference.
- Runtime performance uses a rolling frame-time window, not a single frame.
- Quality may step down after sustained frame pressure but never steps up during an active reveal/action sequence.
- User-selected quality is not silently increased.

## 9. Performance Budgets

- Entry controls interactive before the heavy 3D scene finishes loading.
- Core application JavaScript and CSS load independently from Three.js world assets.
- No layout shift when the canvas initializes.
- Mobile target: stable 60 fps on capable current devices, graceful 30 fps floor on Balanced.
- Desktop target: stable 60 fps at 1440p on a typical integrated GPU.
- Main-thread long tasks over 50 ms during ordinary play are treated as defects.
- Background/hidden tabs stop visual work while WebSocket state remains current.
- Renderer memory and event listeners are fully released when leaving the room route.

## 10. Sound and Haptics

- Sound has spatial flavor but speech/claim information is never audio-only.
- Haptics are short patterns tied to accepted local state changes, not optimistic taps.
- BullShit, penalty, deal, ready, and winner use distinct restrained patterns.
- Haptics Off prevents every vibration call.
- Reduced Effects does not implicitly mute sound or haptics; each preference is independent.
- Browser capability limitations are reflected honestly in settings.

## 11. Reliability and Race Safety

- Visual events subscribe only after the authoritative state is accepted.
- Rapid BullShit calls still resolve through one Durable Object mutation.
- Multiple leave/end-game requests remain idempotent.
- Navigation during a visual sequence cancels scene work without cancelling accepted server work.
- Disconnect during reveal reconnects to the latest snapshot and assembles the settled reveal state.
- Rematch changes `matchId`; delayed V3 visual events from the prior match are discarded.
- Renderer exceptions are contained by a visual error boundary and never tear down the game interface.
- Bots never wait for client animation completion.

## 12. Testing Strategy

### 12.1 Existing Compatibility Suite

- V2 engine, bot, room lifecycle, leave, reconnect, stale action, host transfer, end-game, and Worker regression assertions remain the baseline. Authority/session tests that expected the superseded delayed review phase now assert immediate durable redeal; underlying pure rule tests retain their resolution-stage coverage.

### 12.2 Visual State Tests

- Event adapter tests cover claim, BullShit, reveal, penalty, elimination, reconnect, rematch, leave, and stale revision ordering.
- Scene state tests use seeded time and seeded cosmetic randomness.
- Context loss and renderer rejection tests prove the HTML game remains playable.
- Reduced Effects tests prove continuous animation stops and sequences settle immediately.

### 12.3 Browser Matrix

- Mobile: iPhone Safari dimensions, Android Chrome dimensions, portrait and landscape.
- Desktop: Chrome, Safari/WebKit, and Firefox at laptop and large desktop sizes.
- Quality: Full, Balanced, Reduced, WebGL fallback, and static fallback.
- Input: touch, pointer, keyboard, zoomed text, reduced motion, offline/reconnect.
- Player counts: 2, 6, and 10 with short and maximum-length names.

### 12.4 Visual Verification

- Playwright screenshots cover entry, lobby, claim, live game, reveal, last round, result, settings, share, leave, offline, and reconnect.
- Canvas pixel sampling proves each Three.js scene is nonblank.
- Screenshots verify no overlap, clipping, hidden actions, or unsafe-area collisions.
- A real mobile-browser pass is required before production promotion.

## 13. Delivery Phases

### Phase 0: Isolation

- Create `codex/v3`.
- Copy the verified V2 baseline without generated output.
- Rename package, protocol, client storage, PWA cache, Worker, Durable Object class, and migration.
- Deploy only `bullshit-poker-v3.every-day.workers.dev`.
- Verify the two protected Workers remain unchanged.

### Phase 1: Visual Runtime Foundation

- Build renderer capability detection and quality profiles.
- Add the prioritized V3 frame loop and revision-aware visual event adapter.
- Add renderer/context failure isolation and resource disposal.
- Add deterministic scene test harness and canvas health checks.

Checkpoint implemented:

- `Auto`, `Full`, `Balanced`, and Reduced Effects quality resolution is isolated from gameplay.
- Mobile defaults to Balanced; constrained desktop hardware may also select Balanced.
- The visual frame loop executes ordered stages and clamps resumed-tab deltas.
- Accepted private room snapshots produce deterministic, deduplicated visual events.
- First connect and reconnect produce a settled `SYNC` event rather than replaying history.
- Entry rendering pauses in hidden tabs, renders one stable Reduced Effects frame, and exposes a static context-failure fallback.
- Unit and browser coverage verify the runtime without changing the authoritative game suite.

Deferred runtime enhancements:

- WebGPU capability path with transparent WebGL fallback.
- Runtime rolling-frame performance adaptation.
- Shared Three.js resource manager for the lobby and live-table scenes.

### Phase 2: Living Entry and Lobby

- Rebuild the entry table composition around the existing Deal-In Rail.
- Create physical seat assembly, ready lighting, host treatment, and 2/6/10-player layouts.
- Validate touch orbit, safe framing, responsive labels, and reduced effects.

Implemented checkpoint:

- The lobby is a new split assembly field with an angular Three.js platform, static indexed signal matrix, semantic manifest, and fixed command dock.
- Up to ten authoritative seats are represented by quality-aware human, bot, viewer, current-turn, disconnected, eliminated, ready, and open-seat signals.
- Long names are never positioned on the 3D orbit; complete labels remain collision-free in both signal matrix and manifest.
- The scene uses distinct mobile and desktop camera framing and does not intercept touch or pointer input.
- Automated geometry and screenshot checks cover 2-, 6-, and 10-seat lobbies at 320px mobile, 390px mobile, tablet, laptop, and landscape widths.

### Phase 3: Claim Core and Live Table

- Implement hand-category claim constructions.
- Connect accepted claims, response windows, turns, reactions, and seat presence.
- Preserve the semantic claim controls and private-card shelf.

Implemented checkpoint:

- A shared angular network scene renders inside one continuous arena without owning game state.
- All ten hand categories generate claim-specific one-to-five-card physical formations from the accepted authoritative claim.
- Card textures preserve true red hearts and diamonds and dark spades and clubs.
- Accepted claims, BullShit calls, reveals, penalties, eliminations, reactions, new rounds, and match end feed short interruptible scene energy through the deduplicated visual event bus.
- Unrelated realtime updates no longer recreate claim textures, and all generated textures, geometry, materials, listeners, observers, and WebGL resources are disposed on teardown.
- Reduced Effects produces stable static scene frames; hidden tabs pause rendering; WebGL context loss exposes a nonblocking fallback.
- A two-human browser test holds an accepted claim open and proves the synchronized mobile card formation is visible on the responding player's table.

### Phase 4: BullShit, Reveal, and Results

- Implement interruptible BullShit impact, deterministic reveal, proof highlighting, penalty travel, elimination, and winner sequences.
- Rebuild Last Round and rematch transitions around settled authoritative state.

Interface checkpoint implemented:

- Entry, Deal-In, room command strip, lobby, live game, hand shelf, Claim Forge, reveal, Last Round, settings, share, reactions, confirmation, and winner screens now use the replacement V3 visual system without importing V1/V2 CSS.
- Claim-category formations and authoritative scene reactions are live behind semantic HTML controls on mobile and desktop.
- Viewport-owned sheets, full-height reveal scrolling, stable desktop/mobile hands, touch-safe actions, and mobile landscape composition are browser verified.
- Final cinematic reveal choreography and penalty-card travel remain Phase 4 enhancements; the current authoritative reveal and penalty information is already complete and playable.

### Phase 5: Audio, Haptics, Polish, and Hardening

- Add original audio, haptic patterns, quality adaptation, resource compression, context-loss recovery, and performance instrumentation.
- Complete adversarial race tests and the full browser/device matrix.

### Phase 6: Promotion

- User reviews and explicitly approves the V3 URL.
- Confirm no active rooms on the target production Worker.
- Back up deployment configuration and record rollback version IDs.
- Promote V3 code to `bullshit-poker.every-day.workers.dev` only after explicit approval.
- Keep the V3 Worker online during post-launch observation and rollback window.

## 14. Definition of Done

V3 is ready for production promotion only when:

- Existing game logic tests pass without weakening assertions.
- No visual system owns or blocks game state.
- Mobile and desktop scenes render correctly and remain fully playable.
- Full, Balanced, Reduced, WebGL fallback, and static fallback paths are verified.
- Haptics, sound, reduced effects, reconnection, leave, end-game, and rematch work during visual transitions.
- Two-, six-, and ten-player layouts have no clipped names, controls, cards, or seats.
- Performance budgets are measured on representative mobile and laptop hardware.
- V1/V2 URLs and room namespaces have not been modified.
- The user explicitly approves production promotion.
