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

const SESSION_SYSTEM = `You are a world-class No Limit Texas Hold'em coach reviewing a player's session statistics and hand history. Identify leaks, tendencies, and prioritise the 1-2 most impactful improvements. Be direct, specific, and constructive. Reference the stats and hand data provided. 4-6 sentences maximum. No preamble.`;

const HAND_SYSTEM = `You are a world-class No Limit Texas Hold'em coach doing a street-by-street review of a single hand. Evaluate each decision in context — position, stack depth, board texture, villain tendencies. Be precise: cite sizing, equity, SPR, pot odds where relevant. 4-7 sentences maximum. Lead with the most critical moment in the hand. No preamble.`;

type HistoryMsg = { role: 'user' | 'assistant'; content: string };

type SessionPayload = {
  mode: 'session';
  stats: unknown;
  hands: unknown[];
  userMessage: string;
  history?: HistoryMsg[];
};

type HandPayload = {
  mode: 'hand';
  hand: unknown;
  focusStreet?: string;
  userMessage: string;
  history?: HistoryMsg[];
};

type Payload = SessionPayload | HandPayload;

function parseBody(body: unknown): Payload | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Payload; } catch { return null; }
  }
  return body as Payload;
}

function buildSessionContext(stats: unknown, hands: unknown[]): string {
  const lines = [
    '=== SESSION ANALYSIS ===',
    '',
    'PLAYER STATS:',
    JSON.stringify(stats, null, 2),
    '',
    `RECENT HANDS (${hands.length} total):`,
    JSON.stringify(hands.slice(0, 25), null, 2),
  ];
  return lines.join('\n');
}

function buildHandContext(hand: unknown, focusStreet?: string): string {
  const focus = focusStreet
    ? `\nFOCUS: The player clicked on the ${focusStreet.toUpperCase()} street — centre your analysis on that betting round specifically, then touch on any earlier streets that led to it.\n`
    : '';
  return `=== HAND REVIEW ===${focus}\n${JSON.stringify(hand, null, 2)}`;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload?.mode || !payload?.userMessage) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const history = (payload.history ?? []).slice(-8);
  let context: string;
  let systemPrompt: string;

  if (payload.mode === 'session') {
    context = buildSessionContext(payload.stats, payload.hands);
    systemPrompt = SESSION_SYSTEM;
  } else {
    context = buildHandContext(payload.hand, payload.focusStreet);
    systemPrompt = HAND_SYSTEM;
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: `${context}\n\nQuestion: ${payload.userMessage}` },
  ];

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
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
