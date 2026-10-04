import type pg from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';

/**
 * The layer key is the ONLY value interpolated into SQL here, and only after passing the
 * allowlist. Everything else is a bound parameter.
 */
function assertKnownLayer(layerKey: EditableLayerKey): void {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
    throw new Error(`Unknown layer key: ${String(layerKey)}`);
  }
}

/**
 * Recompute the province/ward codes for every row of one version, writing only the rows whose
 * codes actually change (each rewrite also maintains the partial indexes, so unchanged rows are
 * left alone).
 *
 * Runs in the caller's transaction: on ingest it shares the transaction of the ingest version, on
 * edit the transaction of the draft, so the state "feature exists but has no codes" never exists.
 *
 * Correlated subqueries rather than one aggregating JOIN: each row probes the GiST index of
 * admin.provinces/admin.wards once, and the arrays keep a stable order thanks to ORDER BY.
 *
 * Returns the number of rows of the version that were examined (not the number rewritten).
 */
export async function stampAdminCodes(
  client: pg.PoolClient,
  layerKey: EditableLayerKey,
  versionId: string
): Promise<number> {
  assertKnownLayer(layerKey);
  const result = await client.query<{ examined: number }>(
    `WITH s AS (
       SELECT t.id,
              coalesce((
                SELECT array_agg(p.code ORDER BY p.code)
                  FROM admin.provinces p
                 WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, p.geom)), '{}') AS p,
              coalesce((
                SELECT array_agg(w.code ORDER BY w.code)
                  FROM admin.wards w
                 WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, w.geom)), '{}') AS w
         FROM water.${layerKey} t
        WHERE t.dataset_version_id = $1
     ), u AS (
       UPDATE water.${layerKey} t
          SET province_codes = s.p, ward_codes = s.w
         FROM s
        WHERE t.id = s.id
          AND (t.province_codes IS DISTINCT FROM s.p OR t.ward_codes IS DISTINCT FROM s.w)
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM s)::int AS examined`,
    [versionId]
  );
  return result.rows[0]?.examined ?? 0;
}
