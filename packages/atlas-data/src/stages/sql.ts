import type { Pool } from 'pg';
import type { Stage } from '../types';

/**
 * Run a statement against the pool.
 *
 * Deliberately NOT wrapped in a transaction. REFRESH MATERIALIZED VIEW CONCURRENTLY —
 * how water.rivers_overview is rebuilt — cannot execute inside a transaction block, and
 * that is the first real use of this stage. Statements needing atomicity say so
 * themselves with their own BEGIN/COMMIT.
 */
export async function executeSql(
  pool: Pool,
  stage: Extract<Stage, { type: 'sql' }>
): Promise<void> {
  await pool.query(stage.statement);
}
