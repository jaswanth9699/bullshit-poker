# BullShit Poker

## Complete workspace branch

`codex/all-versions` preserves the current local workspace, including the legacy application at the repository root, the complete `v2/` application, the latest `v3/` application, their tests/assets/specifications, and `POKER_V3_HANDOFF.md`.

| Version | Location |
| --- | --- |
| Original V1 baseline | [`main`](https://github.com/jaswanth9699/bullshit-poker/tree/main), verified at `dcd3430ac7eab9d92f250fb007a6b3ea700ccb35` |
| Legacy application with subsequent local changes | Repository root on this branch (`src/`, `tests/`) |
| V2 | [`v2/`](v2/) and [`bullshit-poker-v2-spec.md`](bullshit-poker-v2-spec.md) |
| V3 | [`v3/`](v3/), [`bullshit-poker-v3-spec.md`](bullshit-poker-v3-spec.md), and [`POKER_V3_HANDOFF.md`](POKER_V3_HANDOFF.md) |

Main and the existing `codex/v3` branch are preserved. This branch includes uncommitted legacy changes as well as V2/V3 work; the root is therefore not an exact copy of the V1 baseline. Dependencies, generated builds, local Worker state, credentials and test artifacts are excluded.

Run commands from the appropriate application directory. For V2 or V3, use `npm ci` followed by `npm run check`. At the root, use `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.

The existing Worker configuration reflects an earlier deployment swap: root `wrangler.toml` targets `bullshit-poker-v2`, `v2/wrangler.toml` targets `bullshit-poker`, and `v3/wrangler.toml` targets `bullshit-poker-v3`. These configurations are preserved as found; a Git push does not deploy any Worker. The legacy deployment instructions below describe the original application.

## Original application overview

A mobile-first, server-authoritative BullShit Poker game built with React, TypeScript, Cloudflare Workers, Durable Objects, and WebSockets.

Live deployment:

https://bullshit-poker.every-day.workers.dev/

## Features

- Room create/join flow with display name and 4-digit PIN reclaim.
- Server-authoritative hidden-card state.
- Real-time play over WebSockets.
- Mobile-first poker table UI with opponent rail, claim timeline, and last-round reveal sheet.
- Host-only bot add/remove in lobby.
- Probability-based server-side bots with delayed actions.
- Automatic next-round start after reveal.
- Crypto-backed Fisher-Yates deck shuffling in production.

## Local Development

Install dependencies:

```bash
npm install
```

Run typecheck, tests, and build:

```bash
npm run typecheck
npm test
npm run build
```

Run the Cloudflare Worker locally:

```bash
npx wrangler dev --local --port 8787
```

## Deployment

This project deploys to Cloudflare Workers with static assets and Durable Objects.

```bash
npm run build
npx wrangler deploy
```

Set `PIN_SECRET` in Cloudflare before production use:

```bash
npx wrangler secret put PIN_SECRET
```
