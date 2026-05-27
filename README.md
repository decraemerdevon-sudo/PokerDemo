# Poker Trainer

Vite/React training table prototype for a Texas Hold'em poker sim.

## Run

```bash
npm install
npm run dev
```

## Hosting

The app is configured for Vercel:

- Vite builds to `dist`.
- `vercel.json` rewrites non-API routes to `index.html` for SPA refresh support.
- GitHub Actions now runs build verification only; production deploys should be handled by the Vercel Git integration for this repo.

No secrets are required for the static frontend. Vercel project connection credentials are required only to enable the production project/link outside this repo.

## Hand-history analytics foundation

Client events are emitted through `src/handHistoryAnalytics.ts` to `POST /api/hand-history`. The Vercel serverless endpoint validates the payload and returns `202 Accepted`; durable storage is intentionally left as the next integration point.

The database-backed foundation and provider recommendation are documented in `docs/hand-history-analytics-foundation.md`.

Payload shape:

```json
{
  "sessionId": "browser-session-id",
  "handId": "demo-hand",
  "events": [
    {
      "id": "event-id",
      "handId": "demo-hand",
      "occurredAt": "2026-05-27T00:00:00.000Z",
      "street": "Flop",
      "actor": "You",
      "action": "Raise",
      "amount": 270,
      "note": "Decision context",
      "source": "hero-action"
    }
  ]
}
```

## Included states

- Waiting
- Player turn
- Showdown
- Review
- Empty history
- Coach idle/loading/ready/error
