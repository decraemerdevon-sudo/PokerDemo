import { Pool } from '@neondatabase/serverless';

type VercelRequest  = { method?: string };
type VercelResponse = { status: (c: number) => VercelResponse; json: (b: unknown) => void };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    response.status(500).json({ error: 'DATABASE_URL environment variable is not set' });
    return;
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hands (
        hand_id              TEXT PRIMARY KEY,
        session_id           TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        hand_number          INTEGER NOT NULL,
        timestamp            BIGINT NOT NULL,
        button_seat_index    INTEGER NOT NULL,
        flop_cards           JSONB,
        turn_card            JSONB,
        river_card           JSONB,
        saw_flop             TEXT[] NOT NULL DEFAULT '{}',
        went_to_showdown     TEXT[] NOT NULL DEFAULT '{}',
        voluntary_put_in_pot TEXT[] NOT NULL DEFAULT '{}',
        players              JSONB NOT NULL,
        streets              JSONB NOT NULL,
        pots                 JSONB NOT NULL,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS hands_session_id_idx ON hands(session_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS hands_timestamp_idx  ON hands(timestamp DESC)`);
    response.status(200).json({ ok: true, message: 'Schema applied successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    response.status(500).json({ error: 'migration_failed', message });
  } finally {
    await pool.end();
  }
}
