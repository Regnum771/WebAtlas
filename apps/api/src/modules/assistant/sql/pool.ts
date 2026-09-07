import pg from 'pg';
import { config } from '../../../config/env';

/**
 * A SEPARATE pool from app.pg, connecting as webatlas_assistant. This is the
 * whole point: the app's pool connects as the owner of every table, so running
 * generated SQL on it would make the query guard the only thing between a
 * model and app.users.
 */
let pool: pg.Pool | undefined;

export function getAssistantPool(): pg.Pool | null {
  if (!config.ASSISTANT_DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.ASSISTANT_DATABASE_URL,
      // Small: this pool serves one optional tool, and a runaway loop must not
      // be able to starve the app's own pool of database connections.
      max: 4,
      // Nothing here should be long-lived; the per-query statement_timeout is 3s.
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function closeAssistantPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
