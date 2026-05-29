import { Pool } from '@neondatabase/serverless';

type VercelRequest  = { method?: string; query?: Record<string, string | string[]> };
type VercelResponse = { status: (c: number) => VercelResponse; json: (b: unknown) => void; setHeader: (n: string, v: string) => void };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    response.status(500).json({ error: 'DATABASE_URL not set' });
    return;
  }

  const playerId = request.query?.playerId;
  if (!playerId || typeof playerId !== 'string') {
    response.status(400).json({ error: 'playerId query param required' });
    return;
  }

  const pool = new Pool({ connectionString: url });
  try {
    const result = await pool.query(
      `SELECT
        hand_id              AS "handId",
        session_id           AS "sessionId",
        hand_number          AS "handNumber",
        timestamp,
        button_seat_index    AS "buttonSeatIndex",
        flop_cards           AS "flopCards",
        turn_card            AS "turnCard",
        river_card           AS "riverCard",
        saw_flop             AS "sawFlop",
        went_to_showdown     AS "wentToShowdown",
        voluntary_put_in_pot AS "voluntaryPutInPot",
        players,
        streets,
        pots
      FROM hands
      WHERE player_id = $1
      ORDER BY timestamp DESC
      LIMIT 200`,
      [playerId]
    );
    response.status(200).json({ hands: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    response.status(500).json({ error: 'db_read_failed', message });
  } finally {
    await pool.end();
  }
}
