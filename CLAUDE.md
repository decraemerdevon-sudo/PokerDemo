# PokerDemo — CLAUDE.md

## Project Vision
A browser-based No Limit Texas Hold'em training application. The goal is to
help players improve by combining realistic gameplay against bots with two
learning tools: live AI coaching during a hand, and post-hand history review.
Target experience is comparable to major online poker software (PokerStars,
GGPoker) in feel and correctness. Single-player vs bots for now, with a
roadmap toward multiplayer and advanced training features.

## Current State (as of 2026-05-30)
- Functional 6-handed NLHE table with bot opponents
- Neon Postgres wired up — hands persist across tab closes and browser sessions
- Session identity: playerId (localStorage, permanent) + sessionId (sessionStorage,
  per-tab) + RUN_ID (module-level constant, per page load)
- DB handIds are namespaced: `${RUN_ID}:${localHandId}` to avoid ON CONFLICT
- Hand history panel: "This Session" / "All Sessions" toggle
  - This Session = hands from current page load only (currentRunHandIds ref)
  - All Sessions = all hands for this playerId from the database
- Session stats (VPIP, PFR, 3-bet, AF, CBet, WTSD, WSD, bb/100) update per view
- Suit symbols display correctly: ♠ ♥ ♦ ♣ (Unicode)
- Seat positions run clockwise: hero (bottom), SB (lower-left), BB (upper-left),
  UTG (top), HJ (upper-right), CO (lower-right)
- Bet chips positioned between each seat and the pot (no panel overlap)
- Rebuy modal: pops up as a centred overlay when hero's stack hits zero
- Add-on: range slider lets player choose any amount from $100 to $1500
- Bot bust recovery: autoRecoverBotSeats() auto-rebuys bots after every hand
- Hand number persists across page refresh (via sessionStorage), resets on tab close
- Live AI coach panel (right rail) — streams advice from claude-sonnet-4-6 via SSE;
  pre-built quick prompt chips; full conversation history per session
- Hand history coaching — AI coach embedded at the bottom of the hand history panel;
  context is driven by the last-clicked element:
  - Session toggle clicked → session mode (leak analysis across stats + recent hands)
  - Hand in list clicked → hand mode (per-street breakdown of that hand)
  - Betting street block clicked → street mode (focused on that street)
  - Each context has its own persistent message thread
- .claude/ configured for Claude Code on the web: auto permission mode + SessionStart
  hook (npm install) + PR workflow instructions
- No authentication yet

## Tech Stack
- Frontend: React 19 + TypeScript + Vite 7
- Styling: Custom CSS (no framework)
- Backend: Vercel Serverless Functions (api/)
- Database: Neon Postgres via @neondatabase/serverless (Pool, not neon tagged templates)
- Auth: None yet — planned Clerk
- Hosting: Vercel (primary) + GitHub Pages via GitHub Actions

## Key Files
- src/nlheEngine.ts          — Core poker engine. Rules, hand logic, bot AI.
                               Do not add UI logic here.
- src/App.tsx                — Main React component. All game state lives here.
                               ~1100+ lines — planned for component split.
- src/handHistory.ts         — Session stats calculation. buildHandRecord() is
                               exported for use in App.tsx.
- src/handHistoryAnalytics.ts — playerId / sessionId management, RUN_ID
                               constant, persistCompletedHand() fire-and-forget.
- src/seatGeometry.ts        — Angle-based seat positioning for the felt layout.
- src/styles.css             — All styling. No inline styles, no CSS framework.
- api/hand-history.ts        — POST endpoint. Writes session + hand to Neon.
- api/hands.ts               — GET endpoint. Reads last 200 hands by playerId.
- api/coach.ts               — POST/SSE endpoint. Streams live coaching advice
                               from claude-sonnet-4-6 given current hand state.
- api/coach-history.ts       — POST/SSE endpoint. Streams coaching analysis of
                               a session (mode:'session') or a single hand with
                               optional street focus (mode:'hand', focusStreet).
- api/migrate.ts             — POST endpoint. Drops and recreates DB schema.
                               Run once via Hoppscotch / curl after deploy.

## Database Schema
Two tables: sessions (session_id PK, player_id, created_at) and
hands (hand_id PK, session_id FK, player_id, hand_number, timestamp, ...,
flop_cards JSONB, turn_card JSONB, river_card JSONB,
saw_flop JSONB, went_to_showdown JSONB, voluntary_put_in_pot JSONB,
players JSONB, streets JSONB, pots JSONB).

All API endpoints use Pool from @neondatabase/serverless with $1..$N
parameterized queries. The neon() tagged template client crashes in Vercel
serverless — do NOT use it.

## Architecture Rules
- Keep engine logic in nlheEngine.ts, UI logic in App.tsx — never mix
- All game state updates must be immutable (no direct mutation)
- Hand history data flows: game engine → handHistory.ts → API endpoint → DB
- Bot decisions belong in nlheEngine.ts, not in React components
- New persistence always goes through the API to the database —
  never localStorage or sessionStorage for hand/session data

## Roadmap (in priority order)
1. ~~Neon Postgres~~ DONE — hands persist via api/hand-history.ts + api/hands.ts
2. Clerk Auth — user identity so history survives across devices and browsers
3. ~~Coaching Agent~~ DONE — live coach panel (api/coach.ts) + hand history
   coaching with click-to-context routing (api/coach-history.ts)
4. App.tsx component split — extract SeatView, BoardView, ActionPanel etc.
5. Vitest — replace raw assertion scripts with a proper test framework

### Long-term Features
- Bot improvements: named personalities, adjustable difficulty, GTO-solving
  engine integration (target: GTO+ or solver-derived ranges)
- Training scenarios: filter by spot type (3-bet pots, blind vs blind, etc.)
- Hand replayer: step through any saved hand action by action
- Leaderboards and player progression tracking
- Multiplayer

## Coaching Agent (DONE)
Two coaching surfaces, both backed by claude-sonnet-4-6 streaming via SSE:

**Live coach panel** (right rail, always visible during play):
- Pre-built quick prompt chips + free-text input
- Sends current hand state (street, board, stacks, pot, hero cards, legal
  actions, recent events) to api/coach.ts
- Full conversation history maintained per session (last 8 messages sent
  as context)

**Hand history coaching** (embedded at the bottom of the hand history panel):
- Context driven by the last element the user clicked:
  - Session toggle → session mode: stats + up to 25 hands → leak analysis
  - Hand in list → hand mode: full HandRecord → per-street breakdown
  - Betting street block → street mode: hand data + focus directive for
    that street (focusStreet field in api/coach-history.ts payload)
- Each context key (`session:view`, `hand:id`, `street:id:street`) has its
  own persistent message thread
- Quick prompts adapt: session / hand / street variants

## Bot Strategy (current + planned)
Current: Three styles — loose-aggressive, balanced, pressure. Realistic
enough for a prototype but not strategically sound.
Planned: Replace bot decision logic in nlheEngine.ts with Claude API calls.
Use claude-haiku-4-5 (fastest, lowest latency) for all bot decisions.
Pass current game state (hole cards, board, pot, position, stack sizes,
action history) as context. System prompt defines GTO-oriented play style.
Pre-fetch bot decisions in the background while the player is deciding
to minimise perceived delay. Show a subtle "thinking..." indicator per seat.

## Conventions
- TypeScript strict mode — no any types
- No CSS frameworks — all styling in styles.css
- Run npm run test:engine before committing changes to nlheEngine.ts
- Commit messages should describe WHY, not just what changed
- Branch per feature, PR to merge into main

## What Not To Do
- Do not add UI logic to nlheEngine.ts
- Do not use localStorage or sessionStorage for new persistence —
  new data goes through the API to the database
- Do not use the neon() tagged template client in serverless functions —
  use Pool with parameterized queries instead
- Do not introduce a CSS framework without discussion
- Do not add authentication logic client-side — auth belongs on the backend
- Do not hard-code bot ranges — strategy logic belongs in nlheEngine.ts

## PR Workflow
After pushing a branch, automatically open a PR and squash-merge it once CI
passes — don't wait for manual approval.

- Prefer GitHub's native auto-merge (`gh pr merge --auto --squash`). If
  "Allow auto-merge" is not enabled on the repo, merge the PR directly once
  all CI checks are green (`gh pr merge --squash`).
- Never merge a PR while any required check is red. If CI fails, diagnose
  the failure, push a fix, and re-verify before merging.
- Delete the branch after merging.
