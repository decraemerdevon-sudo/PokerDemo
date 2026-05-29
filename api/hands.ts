import { getDb } from './db';

type VercelRequest  = { method?: string; query?: Record<string, string | string[]> };
type VercelResponse = { status: (c: number) => VercelResponse; json: (b: unknown) => void; setHeader: (n: string, v: string) => void };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const sessionId = request.query?.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    response.status(400).json({ error: 'sessionId query param required' });
    return;
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        hand_id            AS "handId",
        hand_number        AS "handNumber",
        timestamp,
        button_seat_index  AS "buttonSeatIndex",
        flop_cards         AS "flopCards",
        turn_card          AS "turnCard",
        river_card         AS "riverCard",
        saw_flop           AS "sawFlop",
        went_to_showdown   AS "wentToShowdown",
        voluntary_put_in_pot AS "voluntaryPutInPot",
        players,
        streets,
        pots
      FROM hands
      WHERE session_id = ${sessionId}
      ORDER BY timestamp DESC
      LIMIT 200
    `;
    response.status(200).json({ hands: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    response.status(500).json({ error: 'db_read_failed', message });
  }
}
