# Production source alignment — October 18, 2026

Requested outcome: put the version currently served at https://bullshit-poker.every-day.workers.dev/ on GitHub mainline, retaining the all-versions side branch.

## Source provenance

Started from the V1 mainline commit `dcd3430ac7eab9d92f250fb007a6b3ea700ccb35`. Copied the complete saved V2 project from `codex/all-versions` commit `8cf004b081c84cc7203acc6689fddf58833463fa` into the root. Its production Worker configuration already targets `bullshit-poker` and `RoomDurableObjectV2` after the earlier namespace swap.

The saved V2 frontend was newer than the deployed frontend in three files. Reconstructed the deployed behavior by removing the later haptics capability detection/preview/action cues from App.tsx and the later in-app Reduced Effects integration in KineticScene.tsx/v2.css. Existing production behavior is preserved, including CSS reduced effects, system motion preference handling on scene mount, and reaction/result vibration. No new product features were added.

The rebuild reproduces `index-DhLHl0xD.js`, `index-W4XWtCQj.css` and `KineticScene-A2yM70ST.js` exactly. All ten generated/public frontend files match the live HTTP responses byte-for-byte, including the HTML served at `/` (the server redirects `/index.html`). Hashes are in PRODUCTION_ASSET_VERIFICATION.json.

## Validation and limits

TypeScript, ESLint, 135 unit/integration tests and production build passed. The settings browser test was updated to assert this deployed version's actual behavior: preferences persist, CSS motion stops under Reduced Effects, and the 3D scene honors system reduced motion on mount. The development branch retains tests for its later behavior. Browser results are recorded below after completion.

The initial Cloudflare lookup was unauthenticated. The user subsequently authorized browser sign-in, which enabled authenticated verification. Active production version is `364f19c8-a5cc-44d0-a20c-90b05c230f45` (100% traffic), deployed August 21, 2026. Downloaded its current server module and compared it with a local Wrangler dry-run build. The only differences are five generated dependency-path comments from the local node_modules symlink. Normalizing exactly those path prefixes makes all bundle bytes identical; executable code is unchanged. Hashes and the normalization rule are recorded in PRODUCTION_SERVER_VERIFICATION.json. No Cloudflare deployment or production-room mutation was performed. All browser testing targets an isolated local Worker.

V1 remains in history and `codex/all-versions` remains unchanged. No force push is required: this is a new commit descending from main.

Final browser verification: **12/12 Chrome tests passed** in 46.0 seconds against `http://127.0.0.1:8793`, covering phone/desktop entry, invitations, guest/active leave, lifecycle controls, persisted settings and motion behavior, lobby collisions/long names, ten-seat reveal, and disposable-room smoke. Log: `/tmp/poker-mainline-ui.log`. Unit/build log: `/tmp/poker-mainline-check.log`.
