# BullShit Poker V3 Specification

Status: Phase 0 baseline deployed; Living Bluff Table implementation pending  
Working branch: `codex/v3`  
Development Worker: `bullshit-poker-v3`  
Development URL: `https://bullshit-poker-v3.every-day.workers.dev/`  
Active Phase 1 deployment version: `05e0bac4-3585-48c8-8745-fcd983a8ecf5`  
Protected production URLs: `bullshit-poker.every-day.workers.dev` and `bullshit-poker-v2.every-day.workers.dev`

## 1. Product Thesis

BullShit Poker V3 is a living multiplayer card table, not a conventional application with a decorative 3D background. The table should feel physical, reactive, social, and memorable while every game action remains fast, legible, accessible, and server-authoritative.

The V3 experience is called **Living Bluff Table**.

- Claims materialize as physical card-and-chip constructions at the center of the table.
- Player presence is expressed through seats, light, motion, reactions, and table position.
- A BullShit call creates a decisive table event: tension, impact, reveal, and consequence.
- The environment responds to the match without obscuring cards, claims, players, or controls.
- Mobile receives the complete experience with a composition and performance profile designed specifically for touch devices.
- Reduced Effects is a first-class rendering mode, not a CSS-only approximation.

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

## 4. Original Visual Direction

### 4.1 World

The game occupies an abstract midnight cardroom suspended in a deep spatial field. The center table is a sculpted dark-glass playing surface with restrained cyan edge light, warm white card faces, red suit accents, and selective magenta tension lighting. It must not resemble a casino simulation, Exploding Kittens, or Bruno Simon's driving world.

No decorative object may make a gameplay label harder to read. No blur, particle field, bloom, camera movement, or parallax may pass over the player's cards or primary actions.

### 4.2 Signature Object: The Claim Core

The current claim is represented by a compact physical construction at table center:

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
- **Response window:** the core breathes very slightly; no constant spinning.
- **BullShit:** the table contracts for 120-180 ms, emits a radial light impulse, and separates the claimed formation.
- **Reveal:** physical cards turn in deterministic seat order, then the proof hand is highlighted.
- **Penalty:** one card travels to the penalized seat after the truth result is readable.
- **Elimination:** the seat light closes and the seat recedes without making the player disappear from history.
- **Winner:** remaining seat light connects to the table core; confetti is optional and quality-aware.
- **Reconnect:** the camera does not replay historical events; the scene assembles directly into current state.

Motion is short and interruptible. The latest authoritative state always wins.

## 5. Screen Design

### 5.1 Entry: Walk Up to the Table

- Full-bleed interactive table scene remains visible on mobile and desktop.
- The existing Deal-In Rail remains the direct create/join input surface.
- A shallow pointer or device-tilt response changes table perspective within safe limits.
- Create and Join are immediate modes, not modal cards covering the world.
- PIN fields use numeric one-time-code semantics and must not trigger password-save prompts.
- Loading the 3D layer never blocks entry fields.

### 5.2 Lobby: Table Assembly

- Seats populate around the table with collision-safe labels.
- Ready state changes the seat's physical light and ring, not only a badge.
- Add Bot fills the next open seat through a short deal-in sequence.
- Host actions, share, settings, ready, start, remove, leave, and end-game controls remain available.
- At 8-10 players, a responsive ellipse and label lanes replace radial label overlap.
- A plain player roster remains below the table for scanning and accessible control.

### 5.3 Live Game

- Desktop uses a broad center table, opponent seat rail/orbit, and a stable private-hand dock.
- Mobile uses a top seat rail, full-width claim core, thumb-reachable actions, and a private-hand shelf.
- Current turn, previous claim, round starter, card count, connection state, and phase remain visible without opening a panel.
- Claim timeline can collapse spatially but remains vertically scrollable.
- The player's hand never becomes part of the 3D scene; it stays sharp, private, stable, and inspectable in HTML.

### 5.4 Claim Forge

- Hand category is selected from a compact segmented/radial selector depending on viewport.
- Only legal higher rank/suit choices are offered.
- A lightweight 3D preview assembles as options change.
- Submit uses the existing authoritative command and stale-revision handling.
- The preview is discarded immediately if server state advances.

### 5.5 Reveal and Last Round

- Reveal first establishes True Claim or False Claim, claimant, caller, and penalty in a fixed reading order.
- Cards turn with actual red hearts/diamonds and dark spades/clubs.
- The proof highlight explains which cards satisfy or fail the claim.
- Last Round is a full-height sheet with independent scrolling and safe bottom padding.
- Every player's complete frozen hand remains visible; no clipping or horizontal-only dependency.
- Reduced Effects reveals instantly with a short opacity transition.

### 5.6 Result and Rematch

- The winner occupies the surviving physical seat rather than appearing inside a generic celebration card.
- Match summary, rematch readiness, leave, and host controls remain explicit HTML actions.
- Rematch resets visual event history before the new match revision is consumed.

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

- Prefer `WebGPURenderer` when supported and stable.
- Fall back to WebGL automatically.
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

- All V2 engine, bot, room lifecycle, leave, reconnect, stale action, host transfer, end-game, and Worker tests run unchanged against V3.

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

Still pending in Phase 1:

- WebGPU capability path with transparent WebGL fallback.
- Runtime rolling-frame performance adaptation.
- Shared Three.js resource manager for the lobby and live-table scenes.
- Visual event consumption by the first Living Bluff Table prototype.

### Phase 2: Living Entry and Lobby

- Rebuild the entry table composition around the existing Deal-In Rail.
- Create physical seat assembly, ready lighting, host treatment, and 2/6/10-player layouts.
- Validate touch orbit, safe framing, responsive labels, and reduced effects.

### Phase 3: Claim Core and Live Table

- Implement hand-category claim constructions.
- Connect accepted claims, response windows, turns, reactions, and seat presence.
- Preserve the semantic claim controls and private-card shelf.

### Phase 4: BullShit, Reveal, and Results

- Implement interruptible BullShit impact, deterministic reveal, proof highlighting, penalty travel, elimination, and winner sequences.
- Rebuild Last Round and rematch transitions around settled authoritative state.

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
