import type { Pool } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';

export interface SearchHit {
  layerKey: EditableLayerKey;
  featureId: string;
  name: string;
  lonLat: [number, number];
}

// Only the layers with names worth matching; hazard-zone layers have none.
const SEARCHABLE: EditableLayerKey[] = ['dams', 'lakes', 'rivers', 'stations'];

// The water.<layer>_active views resolve the active dataset-version chain via a
// materialised WITH RECURSIVE + DISTINCT ON pipeline, which is an optimizer fence:
// a `name % $1` filter applied on top of the view cannot be pushed down into it, so
// querying the view directly forces a full scan+dedup of every row in the layer
// before the trigram filter ever runs (confirmed with EXPLAIN: ~5-6s per query on
// ~9.5k rows, no index used). Instead, each layer below first finds candidate
// external_ids straight off the base table — a plain `name % $1` predicate the
// trigram GIN index *can* serve — and only resolves the active-version chain
// (identical logic to the view) for that small candidate set. This is not a
// rewrite of the business rule, just pushing the same filter below the fence.
function layerCtes(key: string): string {
  return `
    active_${key} AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = '${key}' AND is_active
    ),
    chain_${key} AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active_${key} a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain_${key} c ON p.id = c.parent_version_id
    ),
    candidates_${key} AS (
      SELECT DISTINCT external_id FROM water.${key} WHERE name % $1
    ),
    resolved_${key} AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${key} t
        JOIN chain_${key} c ON t.dataset_version_id = c.id
        JOIN candidates_${key} ci ON ci.external_id = t.external_id
        ORDER BY t.external_id, c.depth
    )`;
}

function layerSelect(key: string): string {
  return `
      SELECT '${key}'::text AS layer_key, id::text AS feature_id, name,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             similarity(name, $1) AS sim
      FROM resolved_${key}
      WHERE NOT deleted AND geom IS NOT NULL AND name IS NOT NULL AND name % $1`;
}

/** Trigram search across the named layers, ordered by similarity.
 *  ST_PointOnSurface keeps line/polygon results navigable. */
export async function searchByName(pool: Pool, q: string, limit: number): Promise<SearchHit[]> {
  const ctes = SEARCHABLE.map(layerCtes).join(',\n');
  const unions = SEARCHABLE.map(layerSelect).join(' UNION ALL ');

  const { rows } = await pool.query(
    `WITH RECURSIVE ${ctes} ${unions} ORDER BY sim DESC, name ASC LIMIT $2`,
    [q, limit]
  );

  return rows.map((r) => ({
    layerKey: r.layer_key as EditableLayerKey,
    featureId: r.feature_id,
    name: r.name,
    lonLat: [Number(r.lon), Number(r.lat)],
  }));
}
