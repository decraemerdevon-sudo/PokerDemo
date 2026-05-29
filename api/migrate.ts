import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from './db';

type VercelRequest  = { method?: string };
type VercelResponse = { status: (c: number) => VercelResponse; json: (b: unknown) => void };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  try {
    const sql = getDb();
    const schema = readFileSync(join(process.cwd(), 'api', 'schema.sql'), 'utf8');
    await sql.query(schema);
    response.status(200).json({ ok: true, message: 'Schema applied successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    response.status(500).json({ error: 'migration_failed', message });
  }
}
