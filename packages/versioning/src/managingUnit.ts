import type pg from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';

/** The layer key is the only value interpolated into SQL, and only after the allowlist. */
function assertKnownLayer(layerKey: EditableLayerKey): void {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
    throw new Error(`Unknown layer key: ${String(layerKey)}`);
  }
}

/**
 * Give every live row of one version a managing unit, writing only rows that have none.
 *
 * 1. Inherit: a row whose external_id already exists in the previous state keeps that row's unit.
 *    This must run BEFORE refreshCurrentRows moves is_current, so `is_current` still marks the
 *    previous active state. The unit is versioned data and is never recomputed from geometry once set.
 * 2. Assign: the remaining rows get the initial-assignment rule, admin.managing_unit_for, from the
 *    codes stamped by stampAdminCodes (which therefore must run first).
 *
 * Rows that already carry a value, and tombstones, are never touched.
 * Runs in the caller's transaction.
 */
export async function stampManagingUnits(
  client: pg.PoolClient,
  layerKey: EditableLayerKey,
  versionId: string
): Promise<{ inherited: number; assigned: number }> {
  assertKnownLayer(layerKey);
  const inherited = await client.query(
    `UPDATE water.${layerKey} t
        SET managing_unit = prev.managing_unit
       FROM water.${layerKey} prev
      WHERE t.dataset_version_id = $1
        AND t.managing_unit IS NULL
        AND NOT t.deleted
        AND prev.is_current
        AND prev.external_id = t.external_id
        AND prev.dataset_version_id <> t.dataset_version_id
        AND prev.managing_unit IS NOT NULL`,
    [versionId]
  );
  const assigned = await client.query(
    `UPDATE water.${layerKey} t
        SET managing_unit = admin.managing_unit_for(t.province_codes, t.ward_codes)
      WHERE t.dataset_version_id = $1
        AND t.managing_unit IS NULL
        AND NOT t.deleted`,
    [versionId]
  );
  return { inherited: inherited.rowCount ?? 0, assigned: assigned.rowCount ?? 0 };
}
