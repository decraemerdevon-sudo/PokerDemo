# PokerDemo — CLAUDE.md

## Project Vision
A browser-based No Limit Texas Hold'em training application. The goal is to
help players improve by combining realistic gameplay against bots with two
learning tools: live AI coaching during a hand, and post-hand history review.
Target experience is comparable to major online poker software (PokerStars,
GGPoker) in feel and correctness. Single-player vs bots for now, with a
roadmap toward multiplayer and advanced training features.

## Current State
- Functional 6-handed NLHE table with bot opponents
- Hand history tracked per session (lost on tab close — no DB yet)
- Session stats: VPIP, PFR, 3-bet, aggression factor, bb/100
- Stub analytics API endpoint (returns 202, no persistence)
- No authentication, no database, no coaching agent yet

## Tech Stack
- Frontend: React 19 + TypeScript + Vite 7
- Styling: Custom CSS (no framework)
- Backend: Vercel Serverless Functions (api/)
- Database: None yet — planned Neon Postgres via Vercel Marketplace
- Auth: None yet — planned Clerk
- Hosting: Vercel (primary) + GitHub Pages via GitHub Actions

## Key Files
- src/nlheEngine.ts     — Core poker engine. Rules, hand logic, bot AI.
                          Do not add UI logic here.
- src/App.tsx           — Main React component. All game state lives here.
                          797 lines — planned for component split.
- src/handHistory.ts    — Session stats calculation and sessionStorage
                          persistence. Will migrate to database.
- src/styles.css        — All styling. No inline styles, no CSS framework.
- api/hand-history.ts   — Vercel serverless endpoint. Currently a stub.
                          Will become the database write layer.

## Architecture Rules
- Keep engine logic in nlheEngine.ts, UI logic in App.tsx — never mix
- All game state updates must be immutable (no direct mutation)
- Hand history data flows: game engine → handHistory.ts → API endpoint → DB
- Bot decisions belong in nlheEngine.ts, not in React components

## Roadmap (in priority order)
1. Neon Postgres — wire up api/hand-history.ts to persist hand data
2. Clerk Auth — user identity so history survives across sessions/devices
3. Coaching Agent — Claude API integration, persistent side panel chat
4. App.tsx component split — extract SeatView, BoardView, ActionPanel etc.
5. Vitest — replace raw assertion scripts with a proper test framework

### Long-term Features
- Bot improvements: named personalities, adjustable difficulty, GTO-solving
  engine integration (target: GTO+ or solver-derived ranges)
- Training scenarios: filter by spot type (3-bet pots, blind vs blind, etc.)
- Hand replayer: step through any saved hand action by action
- Leaderboards and player progression tracking
- Multiplayer

## Coaching Agent (planned — Priority 3)
A persistent chat panel in the right rail of the UI. Players can type
questions at any point during or after a hand, or click pre-built prompt
chips for common questions.

Architecture:
- Chat panel component in React UI (right rail, always visible)
- Pre-built prompt chips: "What's my best play here?", "Analyse my last hand",
  "What are my pot odds?", "Was that a mistake?"
- Frontend sends message + current hand state OR selected hand history to
  api/coach.ts (new endpoint)
- Uses claude-sonnet-4-6 for coaching responses (more thorough reasoning)
- Both coach and bots share the same Anthropic SDK client and API key
- Response streams back and renders in the chat panel
- Long term: agent references full session history from the database,
  tracks leaks and tendencies over time

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
- Do not use localStorage or sessionStorage for new features —
  new persistence goes through the API to the database
- Do not introduce a CSS framework without discussion
- Do not add authentication logic client-side — auth belongs on the backend
- Do not hard-code bot ranges — strategy logic belongs in nlheEngine.ts
