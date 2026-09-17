import type { Pool } from 'pg';
import type { Stage } from '../types';

/**
 * Run `stage.statement` against the pool as a single simple-protocol query.
 * The stage itself never adds BEGIN/COMMIT.
 *
 * Contract:
 * - A statement string containing multiple `;`-separated statements runs as
 *   ONE implicit PostgreSQL transaction: all of it applies, or none of it does.
 *   Use that for multi-statement data loads — it's already atomic without any
 *   explicit BEGIN/COMMIT.
 * - Some statements cannot run inside a transaction block at all —
 *   REFRESH MATERIALIZED VIEW CONCURRENTLY (how water.rivers_overview is
 *   rebuilt), VACUUM, CREATE INDEX CONCURRENTLY. Because a multi-statement
 *   string is an implicit transaction, combining one of these with any other
 *   statement fails. Such a statement must be the ONLY statement in its stage;
 *   alone, it works, since the stage adds no transaction of its own.
 */
export async function executeSql(
  pool: Pool,
  stage: Extract<Stage, { type: 'sql' }>
): Promise<void> {
  await pool.query(stage.statement);
}
