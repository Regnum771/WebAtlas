import type { PoolClient } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';

/** How many ingest versions outside the active chain a layer keeps, newest first, with their edits. */
export const EARLIER_LOADS_KEPT = 2;

/**
 * `parent_version_id` cascades on delete, so removing a version removes every version built on
 * it. The kept set is closed under "ancestor of" by construction; this checks it anyway, before
 * anything is deleted.
 */
export function assertPrunable(
  versions: Array<{ id: string; parent: string | null }>,
  doomed: ReadonlySet<string>,
  layerKey: string
): void {
  for (const v of versions) {
    if (!doomed.has(v.id) && v.parent !== null && doomed.has(v.parent)) {
      throw new Error(
        `${layerKey}: kept version ${v.id} descends from ${v.parent}, which would be removed; nothing was removed`
      );
    }
  }
}

/**
 * Remove the layer's versions that retention does not keep (S1 spec §3), with their rows. Kept:
 * the active chain; the EARLIER_LOADS_KEPT most recent ingest versions outside it, with every
 * version built on them; every version in app.version_pins, with its chain to the root.
 *
 * Runs on the caller's client and transaction: from activate() right after the current flag
 * moved, and from the loader's "content unchanged" path under the layer lock. A layer with no
 * active version is left alone: without an active chain there is nothing to measure "earlier"
 * against.
 */
export async function pruneVersions(
  client: PoolClient,
  layerKey: EditableLayerKey
): Promise<{ versions: number; rows: number }> {
  const { rows: all } = await client.query<{ id: string; parent: string | null; doomed: boolean; active: boolean }>(
    `WITH RECURSIVE
       active_chain AS (
         SELECT id, parent_version_id FROM app.dataset_versions WHERE layer_key = $1 AND is_active
         UNION ALL
         SELECT p.id, p.parent_version_id FROM app.dataset_versions p JOIN active_chain c ON p.id = c.parent_version_id
       ),
       earlier_roots AS (
         SELECT id FROM app.dataset_versions
          WHERE layer_key = $1 AND kind = 'ingest' AND id NOT IN (SELECT id FROM active_chain)
          ORDER BY ingested_at DESC, id DESC
          LIMIT $2
       ),
       earlier_trees AS (
         SELECT id FROM earlier_roots
         UNION ALL
         SELECT v.id FROM app.dataset_versions v JOIN earlier_trees t ON v.parent_version_id = t.id
       ),
       pinned AS (
         SELECT v.id, v.parent_version_id
           FROM app.dataset_versions v JOIN app.version_pins p ON p.version_id = v.id
          WHERE v.layer_key = $1
         UNION ALL
         SELECT p.id, p.parent_version_id FROM app.dataset_versions p JOIN pinned c ON p.id = c.parent_version_id
       ),
       kept AS (
         SELECT id FROM active_chain UNION SELECT id FROM earlier_trees UNION SELECT id FROM pinned
       )
     SELECT v.id::text AS id, v.parent_version_id::text AS parent,
            v.id NOT IN (SELECT id FROM kept) AS doomed, v.is_active AS active
       FROM app.dataset_versions v
      WHERE v.layer_key = $1`,
    [layerKey, EARLIER_LOADS_KEPT]
  );
  if (!all.some((v) => v.active)) return { versions: 0, rows: 0 };
  const doomed = all.filter((v) => v.doomed).map((v) => v.id);
  if (doomed.length === 0) return { versions: 0, rows: 0 };
  assertPrunable(all, new Set(doomed), layerKey);

  // Rows first: water.<layer>.dataset_version_id has no cascade.
  const removedRows = await client.query(`DELETE FROM water.${layerKey} WHERE dataset_version_id = ANY($1::uuid[])`, [doomed]);
  await client.query(`DELETE FROM app.dataset_versions WHERE id = ANY($1::uuid[])`, [doomed]);
  return { versions: doomed.length, rows: removedRows.rowCount ?? 0 };
}
