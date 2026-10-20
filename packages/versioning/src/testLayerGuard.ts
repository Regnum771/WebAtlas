import type pg from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';
import { refreshCurrentRows } from './currentRows';

// Test-only, like testPool.ts; not exported from index.ts. Shared by the suites that commit
// activations of synthetic versions on a real layer of the shared dev database.

/**
 * Pin every existing version of the layer under `holder`. An activation in a test prunes the
 * layer, and retention keeps only EARLIER_LOADS_KEPT ingest roots outside the active chain:
 * without the pins, a test's synthetic ingest would push real ingests out of that window.
 */
export async function pinLayer(pool: pg.Pool, layerKey: string, holder: string): Promise<void> {
  await pool.query(
    `INSERT INTO app.version_pins (version_id, holder)
     SELECT id, $2 FROM app.dataset_versions WHERE layer_key = $1
     ON CONFLICT DO NOTHING`,
    [layerKey, holder]
  );
}

/** Drop `holder`'s pins. Their FK is ON DELETE RESTRICT: a leftover blocks deleting a real version. */
export async function unpinLayer(pool: pg.Pool, holder: string): Promise<void> {
  await pool.query(`DELETE FROM app.version_pins WHERE holder = $1`, [holder]);
}

/**
 * Make `versionId` the layer's active version again, with its current flags, in one transaction:
 * the layer never has two active versions, or none. Throws (changing nothing) when the version
 * is gone.
 */
export async function restoreActive(pool: pg.Pool, layerKey: EditableLayerKey, versionId: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = $1 AND is_active`, [layerKey]);
    const flipped = await c.query(
      `UPDATE app.dataset_versions SET is_active = true WHERE id = $1 AND layer_key = $2`, [versionId, layerKey]
    );
    if (flipped.rowCount !== 1) throw new Error(`${layerKey}: version ${versionId} to restore is gone`);
    await refreshCurrentRows(c, layerKey, versionId);
    await c.query('COMMIT');
  } finally {
    // After a COMMIT this is a no-op; after a failure it releases the half-done flip.
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

/** Run every cleanup stage even when an earlier one fails; rethrow the first failure. */
export async function runStages(stages: Array<() => Promise<unknown>>): Promise<void> {
  let failure: unknown = null;
  for (const stage of stages) {
    try {
      await stage();
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure !== null) throw failure;
}
