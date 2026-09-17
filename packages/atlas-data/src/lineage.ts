import type { Pool } from 'pg';
import type { Dataset } from './types';

/**
 * Write the descriptor's declared lineage. Idempotent — re-registering replaces.
 *
 * Runs as a single transaction: the lineage upsert, the wholesale delete of old sources,
 * and every source insert either all commit or all roll back. Without this, a failure
 * partway through the source inserts (e.g. a NOT NULL violation) would leave the old
 * sources already deleted and only some new ones written — a lineage row with a
 * truncated, under-reporting source list. See spec §5 (database stages are transactional).
 */
export async function upsertLineage(pool: Pool, d: Dataset): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO app.dataset_lineage (dataset_id, statement, licence, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (dataset_id)
         DO UPDATE SET statement = EXCLUDED.statement,
                       licence   = EXCLUDED.licence,
                       updated_at = now()`,
      [d.id, d.lineage.statement, d.lineage.licence]
    );

    // Declared sources are replaced wholesale: they describe the descriptor as it is now,
    // not a history. Process-step history lives in dataset_lineage_step instead.
    await client.query(`DELETE FROM app.dataset_lineage_source WHERE dataset_id = $1`, [d.id]);
    for (const s of d.lineage.sources) {
      await client.query(
        `INSERT INTO app.dataset_lineage_source (dataset_id, citation, licence, uri, resolution)
         VALUES ($1, $2, $3, $4, $5)`,
        [d.id, s.citation, s.licence, s.uri ?? null, s.resolution ?? null]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    // If ROLLBACK itself fails (e.g. connection lost), swallow that failure: the
    // caller needs the original error, not one that occurred while cleaning up
    // after it (M2).
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Append an ISO 19115 LI_ProcessStep. Called by the runner after each stage, so lineage
 * is a by-product of execution and cannot drift from what actually ran.
 */
export async function appendProcessStep(
  pool: Pool,
  datasetId: string,
  description: string,
  tool: string
): Promise<void> {
  await pool.query(
    `INSERT INTO app.dataset_lineage_step (dataset_id, description, tool)
     VALUES ($1, $2, $3)`,
    [datasetId, description, tool]
  );
}

/**
 * Every licence that applies to a dataset, including those inherited through dependsOn.
 *
 * Pure and synchronous: it reads the descriptor graph, not the database, so export and
 * CI can ask the question without a connection. Sorted and de-duplicated so callers can
 * compare results directly.
 */
export function resolveLicences(datasets: Dataset[], id: string): string[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const found = new Set<string>();
  const seen = new Set<string>();

  const walk = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const d = byId.get(current);
    if (!d) throw new Error(`Unknown dataset "${current}"`);
    found.add(d.lineage.licence);
    for (const s of d.lineage.sources) found.add(s.licence);
    for (const dep of d.dependsOn ?? []) walk(dep);
  };

  walk(id);
  return [...found].sort();
}
