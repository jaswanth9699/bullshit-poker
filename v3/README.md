# BullShit Poker V3

The isolated V3 workspace for the mobile-first, server-authoritative BullShit Poker game. V3 begins from the verified V2 rules and lifecycle baseline, then adds the Living Bluff Table visual runtime described in `../bullshit-poker-v3-spec.md`.

V3 development deployment:

https://bullshit-poker-v3.every-day.workers.dev/

The existing production Workers are protected and must not be targeted from this directory.

## Baseline Features

- Room create/join flow with display name and 4-digit PIN reclaim.
- Server-authoritative hidden-card state.
- Real-time play over WebSockets.
- Mobile-first table UI with opponent rail, claim timeline, and last-round reveal sheet.
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

Run the isolated V3 Cloudflare Worker locally:

```bash
npx wrangler dev --local --port 8791
```

## Deployment

This configuration targets only the `bullshit-poker-v3` Worker and the `RoomDurableObjectV3` namespace.

```bash
npm run build
npx wrangler deploy
```

Set `PIN_SECRET` in Cloudflare before production use:

```bash
npx wrangler secret put PIN_SECRET
```
