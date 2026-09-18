import 'dotenv/config';
import pg from 'pg';

/**
 * A SEPARATE pool from app.pg, sized small on purpose.
 *
 * POST /api/analysis/:op (routes.ts) is unauthenticated and rate-limited only
 * per IP (60/min) — that bounds rate, not concurrency. Each request holds a
 * client for up to ANALYSIS_TIMEOUT_MS (db.ts), and the app's own pool
 * (db/pool.ts) has pg's default max of 10: a few tabs firing parallel
 * zonal_elevation/elevation_profile calls could occupy every one of those
 * clients and make /api/auth/login, /api/layers/... and the assistant hang
 * instead of erroring. Giving analysis its own small pool caps that
 * concurrency without touching the app pool's budget — the same isolation
 * modules/assistant/sql/pool.ts uses for the SQL escape hatch ("a runaway
 * loop must not be able to starve the app's own pool").
 */
let pool: pg.Pool | undefined;

export function getAnalysisPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({
      connectionString,
      // 2-3 concurrent analyses covers one browser session's toolbar clicks;
      // beyond that, new requests should queue then fail fast (see
      // connectionTimeoutMillis below and db.ts's ANALYSIS_BUSY), not eat into
      // the 10 clients every other route depends on.
      max: 3,
      // A saturated analysis pool rejects a new checkout quickly instead of
      // leaving the caller to hang — db.ts turns that rejection into a clean
      // 503 ANALYSIS_BUSY.
      connectionTimeoutMillis: 3000,
      // Nothing here should be long-lived; the per-query statement_timeout is
      // ANALYSIS_TIMEOUT_MS (5s, see db.ts).
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function closeAnalysisPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
