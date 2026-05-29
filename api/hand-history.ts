import { Pool } from '@neondatabase/serverless';

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
  playerId?: string;
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

  const url = process.env.DATABASE_URL;
  if (!url) {
    response.status(500).json({ error: 'DATABASE_URL not set' });
    return;
  }

  const payload = parsePayload(request.body);
  if (!payload?.playerId || !payload?.sessionId || !payload?.hand?.handId) {
    response.status(400).json({ error: 'invalid_payload' });
    return;
  }

  const { playerId, sessionId, hand } = payload;
  const pool = new Pool({ connectionString: url });

  try {
    await pool.query(
      `INSERT INTO sessions (session_id, player_id) VALUES ($1, $2) ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, playerId]
    );

    await pool.query(
      `INSERT INTO hands (
        hand_id, session_id, player_id, hand_number, timestamp, button_seat_index,
        flop_cards, turn_card, river_card,
        saw_flop, went_to_showdown, voluntary_put_in_pot,
        players, streets, pots
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (hand_id) DO NOTHING`,
      [
        hand.handId,
        sessionId,
        playerId,
        hand.handNumber,
        hand.timestamp,
        hand.buttonSeatIndex,
        hand.flopCards  ? JSON.stringify(hand.flopCards)  : null,
        hand.turnCard   ? JSON.stringify(hand.turnCard)   : null,
        hand.riverCard  ? JSON.stringify(hand.riverCard)  : null,
        JSON.stringify(hand.sawFlop),
        JSON.stringify(hand.wentToShowdown),
        JSON.stringify(hand.voluntaryPutInPot),
        JSON.stringify(hand.players),
        JSON.stringify(hand.streets),
        JSON.stringify(hand.pots),
      ]
    );

    response.status(201).json({ ok: true, handId: hand.handId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    response.status(500).json({ error: 'db_write_failed', message });
  } finally {
    await pool.end();
  }
}
