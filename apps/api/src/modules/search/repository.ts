import type { Pool } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '../../reference/registry';

export interface SearchHit {
  layerKey: EditableLayerKey | ReferenceLayerKey;
  featureId: string;
  name: string;
  /** 'layer' = an editable water feature; 'reference' = a dissolved basemap entity. */
  source: 'layer' | 'reference';
  lonLat: [number, number];
}

// Only the layers with names worth matching; hazard-zone layers have none.
const SEARCHABLE: EditableLayerKey[] = ['dams', 'lakes', 'rivers', 'stations'];

const REFERENCE_PREFIX = 'ref:';

/** Every token /api/search accepts in `sources`. */
export const SEARCH_SOURCES: readonly string[] = [
  ...SEARCHABLE,
  ...REFERENCE_LAYER_KEYS.map((k) => `${REFERENCE_PREFIX}${k}`),
];

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
      SELECT '${key}'::text AS layer_key, 'layer'::text AS source, id::text AS feature_id, name,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             similarity(name, $1) AS sim
      FROM resolved_${key}
      WHERE NOT deleted AND geom IS NOT NULL AND name IS NOT NULL AND name % $1`;
}

/**
 * Reference entities are already dissolved, so one row is one answer — "Quốc lộ 14"
 * rather than 3,000 segments. They need none of the dataset-version machinery the
 * water layers need: basemap is unversioned, and the trigram indexes live on
 * basemap.reference_entities (see migration 17 for why not on the raw tables).
 */
function referenceSelect(keys: ReferenceLayerKey[]): string {
  return `
      -- 24 roads entities (route numbers like "04/22L", "16", "18B", "19") carry a
      -- ref but no name -- exactly the query this feature exists to serve. coalesce
      -- to ref so those are still findable and SearchHit.name is never null; the
      -- order (name first) matches search's intent of preferring the human name,
      -- the opposite of area.ts's coalesce(ref, name) which prefers the route
      -- number for a buffer label.
      SELECT layer_key AS layer_key, 'reference'::text AS source, entity_id AS feature_id,
             coalesce(name, ref) AS name,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             GREATEST(coalesce(similarity(name, $1), 0), coalesce(similarity(ref, $1), 0)) AS sim
      FROM basemap.reference_entities
      WHERE layer_key = ANY(ARRAY[${keys.map((k) => `'${k}'`).join(',')}])
        AND (name % $1 OR ref % $1)`;
}

/** Trigram search across the requested sources, ordered by similarity.
 *  ST_PointOnSurface keeps line/polygon results navigable. */
export async function searchByName(
  pool: Pool,
  q: string,
  limit: number,
  sources: readonly string[] = SEARCHABLE
): Promise<SearchHit[]> {
  // Self-defending, not just relying on the controller's allowlist refine: a
  // duplicate token (e.g. `sources=dams,dams`) would otherwise reach layerCtes()
  // twice and emit the same CTE name twice ("active_dams", "chain_dams", ...),
  // which Postgres rejects with "WITH query name ... specified more than once" --
  // a 500 on a public endpoint. This file is the one that interpolates those
  // identifiers into SQL, so it must not trust the caller to have deduplicated.
  // Also drops anything outside the allowlist for the same reason.
  const unique = [...new Set(sources)].filter((s) => SEARCH_SOURCES.includes(s));

  const layerKeys = unique.filter((s) => !s.startsWith(REFERENCE_PREFIX)) as EditableLayerKey[];
  const referenceKeys = unique
    .filter((s) => s.startsWith(REFERENCE_PREFIX))
    .map((s) => s.slice(REFERENCE_PREFIX.length)) as ReferenceLayerKey[];

  const selects: string[] = [];
  const ctes = layerKeys.map(layerCtes).join(',\n');
  for (const key of layerKeys) {
    selects.push(layerSelect(key));
  }
  if (referenceKeys.length) selects.push(referenceSelect(referenceKeys));

  if (!selects.length) return [];

  const prelude = ctes ? `WITH RECURSIVE ${ctes}` : '';
  const { rows } = await pool.query(
    `${prelude} ${selects.join(' UNION ALL ')} ORDER BY sim DESC, name ASC LIMIT $2`,
    [q, limit]
  );

  return rows.map((r) => ({
    layerKey: r.layer_key as EditableLayerKey | ReferenceLayerKey,
    featureId: r.feature_id,
    name: r.name,
    source: r.source as 'layer' | 'reference',
    lonLat: [Number(r.lon), Number(r.lat)],
  }));
}
