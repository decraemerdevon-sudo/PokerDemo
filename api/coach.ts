import Anthropic from '@anthropic-ai/sdk';

type VercelReq = { method?: string; body?: unknown };
type VercelRes = {
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => void;
  end: () => void;
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a world-class No Limit Texas Hold'em coach embedded in a poker training app. Give precise, actionable advice tailored exactly to the game state provided.

Rules:
- 3-5 sentences maximum. Lead with the recommended action and sizing.
- Be specific: cite pot odds, SPR, equity estimates, position advantage.
- Reference opponent tendencies (their position, last action, stack size).
- Use poker shorthand naturally (IP, OOP, SPR, c-bet, 3-bet, value-to-bluff ratio, etc.).
- No preamble. No filler. Direct coaching only.
- If asked about a past action, evaluate it honestly and constructively.`;

type PlayerInfo = {
  name: string;
  role: string;
  stack: number;
  streetContribution: number;
  status: string;
  isHero?: boolean;
  lastAction: string;
};

type GameState = {
  street: string;
  handNumber: number;
  board: string[];
  pot: number;
  heroCards: string[];
  heroRole: string;
  heroStack: number;
  heroStreetContribution: number;
  legalActions: string[];
  players: PlayerInfo[];
  recentEvents: string[];
  bigBlind: number;
};

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

function buildContext(gs: GameState): string {
  const fmt = (cards: string[]) =>
    cards.map((c) => `${c.slice(0, -1)}${SUIT[c.slice(-1)] ?? c.slice(-1)}`).join(' ');

  const spr =
    gs.heroStack > 0 && gs.pot > 0
      ? (gs.heroStack / gs.pot).toFixed(1)
      : '∞';

  const lines: string[] = [
    `=== HAND #${gs.handNumber} | Street: ${gs.street} | Blinds $${gs.bigBlind / 2}/$${gs.bigBlind} ===`,
    `Board: ${gs.board.length ? fmt(gs.board) : '(preflop)'} | Pot: $${gs.pot}`,
    '',
    `HERO [${gs.heroRole}]: ${fmt(gs.heroCards)} | Stack $${gs.heroStack} | In pot this street $${gs.heroStreetContribution} | SPR ${spr}`,
    gs.legalActions.length
      ? `Legal actions: ${gs.legalActions.join(', ')}`
      : '(hand complete — no actions)',
    '',
    'TABLE:',
    ...gs.players.map(
      (p) =>
        `  ${p.isHero ? '→ YOU' : p.name} [${p.role}]: ${p.status} | stack $${p.stack} | contributed $${p.streetContribution} | ${p.lastAction}`,
    ),
    '',
    'RECENT ACTION:',
    ...gs.recentEvents.map((e) => `  ${e}`),
  ];
  return lines.join('\n');
}

type HistoryMsg = { role: 'user' | 'assistant'; content: string };
type Payload = { gameState?: GameState; userMessage?: string; history?: HistoryMsg[] };

function parseBody(body: unknown): Payload | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Payload; } catch { return null; }
  }
  return body as Payload;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload?.gameState || !payload?.userMessage) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const { gameState, userMessage, history = [] } = payload;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const context = buildContext(gameState);
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: `${context}\n\nQuestion: ${userMessage}` },
  ];

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Coach unavailable';
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.write('data: [DONE]\n\n');
  }

  res.end();
}
