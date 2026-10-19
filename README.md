# BullShit Poker — production V2

This mainline contains the V2 application running at [bullshit-poker.every-day.workers.dev](https://bullshit-poker.every-day.workers.dev/), verified on October 18, 2026. The root project is the production app; no subdirectory is needed to run it.

The rebuilt HTML, both JavaScript bundles, stylesheet, three image assets, icon, manifest and service worker match the public deployment byte-for-byte. See [verification hashes](PRODUCTION_ASSET_VERIFICATION.json) and [recovery notes](PRODUCTION_SOURCE.md).

## Versions

- [Complete development workspace](https://github.com/jaswanth9699/bullshit-poker/tree/codex/all-versions): later legacy changes, complete V2 development source, latest V3, tests, assets and specifications.
- [Original V1 baseline](https://github.com/jaswanth9699/bullshit-poker/tree/dcd3430ac7eab9d92f250fb007a6b3ea700ccb35): preserved in Git history.
- The later V2 haptics and reduced-effects enhancements remain on the development branch; this mainline reproduces the currently deployed frontend.

## Development

Use Node.js 22.18+ (validation used Node 25.9.0).

```sh
npm ci
npm run check
npm run dev
```

`npm run check` runs TypeScript, ESLint, unit/integration tests and a production build. Run browser tests against your local Worker using:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8787 npm run test:ui
```

## Deployment target

`wrangler.toml` targets `bullshit-poker`, with `APP_VERSION=2.0.0`, `RoomDurableObjectV2` and the existing namespace-swap migration history. This Git update did not deploy or modify the live Worker.

Authenticated Cloudflare verification also confirms the server bundle matches active version `364f19c8-a5cc-44d0-a20c-90b05c230f45`, apart from five generated dependency-path comments caused by the local test setup. All other bytes are identical. See [server verification hashes](PRODUCTION_SERVER_VERIFICATION.json).
