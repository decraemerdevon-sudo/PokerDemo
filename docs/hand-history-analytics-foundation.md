# Hand-History Analytics Foundation

## Scope

This ticket keeps the poker sim as a trainer prototype. It does not add real-money play, public poker-room behavior, or multiplayer.

## Current hosting path

- The app is a Vite SPA that builds with `npm run build` into `dist`.
- `vercel.json` defines the Vercel build command, output directory, and SPA rewrite.
- `vite.config.js` no longer pins assets to `/PokerDemo/`, so the app can run at a Vercel root domain or preview URL.
- The current GitHub Pages workflow still exists because the available GitHub token cannot update workflow files without `workflow` scope.

## Minimal analytics model

Start with append-only hand history storage before aggregate dashboards. That keeps the raw audit trail intact and lets trend metrics be recomputed as the product changes.

Tables:

- `sessions`: one browser/user training session. Columns: `id`, `user_id` nullable until auth exists, `anonymous_id`, `started_at`, `ended_at`, `client_version`.
- `hands`: one dealt hand. Columns: `id`, `session_id`, `game_type`, `stakes_label`, `hero_seat`, `started_at`, `ended_at`, `outcome`, `net_chips`.
- `hand_actions`: ordered action log. Columns: `id`, `hand_id`, `street`, `sequence_number`, `actor`, `action`, `amount`, `pot_before`, `stack_before`, `created_at`.
- `coach_prompts`: coach request/response audit trail. Columns: `id`, `hand_id`, `action_id` nullable, `prompt`, `response`, `model`, `latency_ms`, `created_at`.
- `hand_metrics`: derived per-hand metrics. Columns: `hand_id`, `vpip`, `pfr`, `aggression_factor`, `showdown_seen`, `won_at_showdown`, `created_at`.

First trend metrics:

- Hands played per session.
- VPIP/PFR/aggression trend by session and street.
- Net chips by session.
- Coach prompts per hand and average latency.
- Common leak markers, such as over-folding river or calling too wide preflop.

## Database recommendation

Use Neon Postgres through the Vercel Marketplace as the first DB step.

Rationale:

- Vercel's current Postgres docs state that Vercel Postgres is no longer available for new projects and that new Postgres databases should be connected through external Marketplace providers: https://vercel.com/docs/postgres
- Neon is the closest fit for the current Vercel hosting path because the Vercel Marketplace integration provisions Postgres, injects environment variables into the Vercel project, and supports branching/autoscaling/scale-to-zero: https://vercel.com/marketplace/neon
- Postgres fits both saved training sessions now and future multiplayer foundations later because hand/action history wants relational ordering, joins, and transaction boundaries.

Tradeoffs:

- Neon: best default for Vercel previews and serverless Postgres. Watch idle cold-start latency for analytics endpoints and size up if write volume grows.
- Supabase: stronger if auth, realtime subscriptions, and row-level-security should be bundled quickly. More product surface to own, and less direct Vercel preview-branch ergonomics.
- Prisma Postgres: useful if the app standardizes on Prisma early. Adds ORM/provider coupling before schema needs are complex.
- Plain external Postgres: maximum portability, but more manual secret propagation and preview database management.

## Next implementation step

After Vercel project access exists, attach Neon via the Vercel Marketplace, add `DATABASE_URL`, and replace the temporary `202 Accepted` endpoint in `api/hand-history.ts` with inserts into `sessions`, `hands`, and `hand_actions`.
