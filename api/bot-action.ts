import Anthropic from '@anthropic-ai/sdk';

type VercelReq = { method?: string; body?: unknown };
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

const client = new Anthropic();

const STYLE_PERSONA: Record<string, string> = {
  'loose-aggressive': 'You play loose-aggressive: wide ranges, frequent bets and raises, apply pressure relentlessly. You bluff often and build big pots.',
  'balanced': 'You play a balanced, GTO-informed style: solid ranges, appropriate bet sizing, mix of value and bluffs at correct frequencies.',
  'pressure': 'You play a tight-aggressive pressure style: selective but when you enter a pot you bet and raise aggressively, rarely checking or calling passively.',
};

const BASE_SYSTEM = `You are an expert No-Limit Texas Hold\'em player making a single decision at a 6-handed cash game table.

{PERSONA}

Rules:
- Respond with ONLY valid JSON: {"kind":"fold"|"check"|"call"|"raise"|"bet","targetContribution":<number|null>}
- targetContribution is required (not null) for "raise" and "bet" actions — it is the total chips you will have committed this street after the action
- targetContribution must be between min and max shown for that action
- For "fold", "check", "call" set targetContribution to null
- No explanation, no markdown, only the JSON object`;

type SeatInfo = {
  id: string;
  name: string;
  role: string;
  stack: number;
  streetContribution: number;
  status: string;
  isHero: boolean;
  isBot: boolean;
  holeCards: string[] | null;
};

type LegalAction = {
  kind: string;
  label: string;
  targetContribution?: number;
  min?: number;
  max?: number;
};

type BotActionPayload = {
  street: string;
  handNumber: number;
  board: string[];
  pot: number;
  bigBlind: number;
  botStyle: string;
  botSeatId: string;
  seats: SeatInfo[];
  legalActions: LegalAction[];
  recentEvents: string[];
};

function parseBody(body: unknown): BotActionPayload | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as BotActionPayload; } catch { return null; }
  }
  return body as BotActionPayload;
}

function buildContext(p: BotActionPayload): string {
  const bot = p.seats.find((s) => s.id === p.botSeatId)!;
  const spr = bot.stack > 0 && p.pot > 0 ? (bot.stack / p.pot).toFixed(1) : '∞';

  const lines = [
    `=== HAND #${p.handNumber} | ${p.street} | Blinds $${p.bigBlind / 2}/$${p.bigBlind} ===`,
    `Board: ${p.board.length ? p.board.join(' ') : '(preflop)'} | Pot: $${p.pot}`,
    '',
    `YOU [${bot.role}]: ${bot.holeCards?.join(' ') ?? '??'} | Stack $${bot.stack} | In pot $${bot.streetContribution} | SPR ${spr}`,
    '',
    'TABLE:',
    ...p.seats.map((s) =>
      `  ${s.id === bot.id ? '→ YOU' : s.name} [${s.role}]: ${s.status} | stack $${s.stack} | committed $${s.streetContribution}${s.holeCards ? ` | cards ${s.holeCards.join(' ')}` : ''}`
    ),
    '',
    'RECENT ACTION:',
    ...p.recentEvents.map((e) => `  ${e}`),
    '',
    'LEGAL ACTIONS:',
    ...p.legalActions.map((a) => {
      const range = (a.min != null && a.max != null) ? ` (min $${a.min}, max $${a.max})` : '';
      return `  ${a.kind}: ${a.label}${range}`;
    }),
  ];
  return lines.join('\n');
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload?.botSeatId || !payload?.legalActions?.length) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const persona = STYLE_PERSONA[payload.botStyle] ?? STYLE_PERSONA['balanced'];
  const system = BASE_SYSTEM.replace('{PERSONA}', persona);
  const context = buildContext(payload);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      system,
      messages: [{ role: 'user', content: context }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const parsed = JSON.parse(text) as { kind: string; targetContribution: number | null };

    const validKinds = new Set(payload.legalActions.map((a) => a.kind));
    if (!validKinds.has(parsed.kind)) {
      // Fallback: if Claude picked an illegal action, default to check or fold
      const fallback = payload.legalActions.find((a) => a.kind === 'check') ?? payload.legalActions[0];
      res.status(200).json({ kind: fallback.kind, targetContribution: fallback.targetContribution ?? null });
      return;
    }

    res.status(200).json({
      kind: parsed.kind,
      targetContribution: parsed.targetContribution ?? undefined,
    });
  } catch {
    // Any failure: fall back to check or fold
    const fallback = payload.legalActions.find((a) => a.kind === 'check') ?? payload.legalActions[0];
    res.status(200).json({ kind: fallback.kind, targetContribution: fallback.targetContribution ?? null });
  }
}
