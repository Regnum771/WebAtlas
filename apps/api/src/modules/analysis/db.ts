import type { Pool } from 'pg';
import { AppError } from '../../errors';
import type { Queryable } from '../assistant/tools/data/helpers';

export const ANALYSIS_TIMEOUT_MS = 5000;

/** Postgres "query_canceled" — what statement_timeout raises. */
const QUERY_CANCELED = '57014';

/**
 * Runs an analysis on one client inside a READ ONLY transaction with a local
 * statement_timeout. Analysis input is user-drawn, so a huge polygon over the DEM
 * is one click away; the timeout bounds it, and READ ONLY makes the module
 * structurally unable to write even if a future op is careless.
 */
export async function withAnalysisTimeout<T>(
  pool: Pool,
  fn: (db: Queryable) => Promise<T>,
  timeoutMs: number = ANALYSIS_TIMEOUT_MS
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* transaction already ended */ }
    if ((e as { code?: string }).code === QUERY_CANCELED) {
      throw new AppError(504, 'ANALYSIS_TIMEOUT', 'Phép phân tích quá lâu, hãy thu nhỏ vùng.');
    }
    throw e;
  } finally {
    client.release();
  }
}
