# BullShit Poker

A mobile-first, server-authoritative BullShit Poker game built with React, TypeScript, Cloudflare Workers, Durable Objects, and WebSockets.

Live deployment:

https://bullshit-poker.saichallagulla.workers.dev

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
