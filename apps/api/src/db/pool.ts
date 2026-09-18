import 'dotenv/config';
import pg from 'pg';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({
      connectionString,
      // Without this, a saturated pool leaves callers of pool.connect() waiting
      // indefinitely instead of erroring — see modules/analysis/pool.ts for the
      // incident this class of bug caused (the analysis route holding all 10
      // default clients and hanging every other route).
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
