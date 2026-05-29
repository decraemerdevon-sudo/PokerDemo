import { getDb } from './db';

type HandRecord = {
  handId: string;
  handNumber: number;
  timestamp: number;
  buttonSeatIndex: number;
  players: unknown[];
  flopCards: unknown[] | null;
  turnCard: unknown | null;
  riverCard: unknown | null;
  streets: unknown;
  pots: unknown[];
  sawFlop: string[];
  wentToShowdown: string[];
  voluntaryPutInPot: string[];
};

type HandHistoryPayload = {
  sessionId?: string;
  hand?: HandRecord;
};

type VercelRequest  = { method?: string; body?: unknown };
type VercelResponse = { status: (c: number) => VercelResponse; json: (b: unknown) => void; setHeader: (n: string, v: string) => void };

function parsePayload(body: unknown): HandHistoryPayload | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as HandHistoryPayload; } catch { return null; }
  }
  return body as HandHistoryPayload;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = parsePayload(request.body);
  if (!payload?.sessionId || !payload?.hand?.handId) {
    response.status(400).json({ error: 'invalid_payload' });
    return;
  }

  const { sessionId, hand } = payload;

  try {
    const sql = getDb();

    await sql`
      INSERT INTO sessions (session_id)
      VALUES (${sessionId})
      ON CONFLICT (session_id) DO NOTHING
    `;

    await sql`
      INSERT INTO hands (
        hand_id, session_id, hand_number, timestamp, button_seat_index,
        flop_cards, turn_card, river_card,
        saw_flop, went_to_showdown, voluntary_put_in_pot,
        players, streets, pots
      ) VALUES (
        ${hand.handId},
        ${sessionId},
        ${hand.handNumber},
        ${hand.timestamp},
        ${hand.buttonSeatIndex},
        ${hand.flopCards ?? null},
        ${hand.turnCard  ?? null},
        ${hand.riverCard ?? null},
        ${JSON.stringify(hand.sawFlop)},
        ${JSON.stringify(hand.wentToShowdown)},
        ${JSON.stringify(hand.voluntaryPutInPot)},
        ${JSON.stringify(hand.players)},
        ${JSON.stringify(hand.streets)},
        ${JSON.stringify(hand.pots)}
      )
      ON CONFLICT (hand_id) DO NOTHING
    `;

    response.status(201).json({ ok: true, handId: hand.handId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    response.status(500).json({ error: 'db_write_failed', message });
  }
}
