import 'dotenv/config';
import pg from 'pg';
import { ensureSeeded } from '@webatlas/atlas-data';

/**
 * Once per test run, before any suite: the thematic layers the suites read are brought to the
 * committed seed content, through the loader atlas:build uses. Content that is already there is
 * left alone, so repeated runs add no dataset versions (they used to add one per layer per run).
 * If a layer carries steward edits over different content this fails rather than load over them.
 */
export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (apps/api/.env)');
  const pool = new pg.Pool({ connectionString });
  try {
    const changed = (await ensureSeeded(pool)).filter((o) => o.action !== 'unchanged');
    for (const o of changed) console.log(`[seed] ${o.action} ${o.id}: ${o.detail}`);
  } finally {
    await pool.end();
  }
}
