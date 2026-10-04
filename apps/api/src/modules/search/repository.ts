import type { Pool } from 'pg';
import { REGION_PROVINCE_CODES, type AdminLevel, type EditableLayerKey } from '@webatlas/shared';
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '../../reference/registry';
import { entityPredicate } from '../assistant/tools/data/helpers';

export interface SearchHit {
  layerKey: EditableLayerKey | ReferenceLayerKey | AdminLevel;
  featureId: string;
  name: string;
  /** 'layer' = an editable water feature; 'reference' = a dissolved basemap entity;
   *  'admin' = a province or ward of the working region (featureId is its code). */
  source: 'layer' | 'reference' | 'admin';
  lonLat: [number, number];
}

// Only the layers with names worth matching; hazard-zone layers have none.
const SEARCHABLE: EditableLayerKey[] = ['dams', 'lakes', 'rivers', 'stations'];

const REFERENCE_PREFIX = 'ref:';

/** Every token /api/search accepts in `sources`. */
export const SEARCH_SOURCES: readonly string[] = [
  ...SEARCHABLE,
  ...REFERENCE_LAYER_KEYS.map((k) => `${REFERENCE_PREFIX}${k}`),
  'admin',
];

// Each layer is searched through its active view, a plain filter that the partial trigram
// index serves (S1). Rivers carry three levels since the topology ingest; search means the
// ENTITY (entityPredicate): a level-1 row is one river, so "thu" returns Sông Thu Bồn once, not
// several of its OSM ways. Reaches (level 2) have no name at all.
function layerSelect(key: EditableLayerKey): string {
  return `
      SELECT '${key}'::text AS layer_key, 'layer'::text AS source, id::text AS feature_id, name,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             similarity(name, $1) AS sim
      FROM water.${key}_active
      WHERE geom IS NOT NULL AND name IS NOT NULL AND name % $1
        AND ${entityPredicate(key)}`;
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

/**
 * The six working provinces and their 616 wards (spec §10). 622 rows: no index needed.
 * Only in-region units, because an ROI outside the region is refused anyway — a hit
 * that cannot be used would only mislead.
 */
function adminSelect(): string {
  const codes = REGION_PROVINCE_CODES.map((c) => `'${c}'`).join(',');
  return `
        SELECT 'province'::text AS layer_key, 'admin'::text AS source, code AS feature_id,
               coalesce(full_name, name) AS name,
               ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
               GREATEST(similarity(name, $1), coalesce(similarity(full_name, $1), 0)) AS sim
          FROM admin.provinces
         WHERE code = ANY(ARRAY[${codes}]) AND (name % $1 OR full_name % $1)
        UNION ALL
        SELECT 'ward'::text, 'admin'::text, code, coalesce(full_name, name),
               ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom)),
               GREATEST(similarity(name, $1), coalesce(similarity(full_name, $1), 0))
          FROM admin.wards
         WHERE province_code = ANY(ARRAY[${codes}]) AND (name % $1 OR full_name % $1)`;
}

/** Trigram search across the requested sources, ordered by similarity.
 *  ST_PointOnSurface keeps line/polygon results navigable. */
export async function searchByName(
  pool: Pool,
  q: string,
  limit: number,
  sources: readonly string[] = SEARCHABLE
): Promise<SearchHit[]> {
  // Self-defending, not just relying on the controller's allowlist refine: a duplicate token
  // (`sources=dams,dams`) would return every hit twice, and anything outside the allowlist must
  // never reach the SQL below, which interpolates these keys.
  const unique = [...new Set(sources)].filter((s) => SEARCH_SOURCES.includes(s));

  const wantAdmin = unique.includes('admin');
  const layerKeys = unique.filter((s) => !s.startsWith(REFERENCE_PREFIX) && s !== 'admin') as EditableLayerKey[];
  const referenceKeys = unique
    .filter((s) => s.startsWith(REFERENCE_PREFIX))
    .map((s) => s.slice(REFERENCE_PREFIX.length)) as ReferenceLayerKey[];

  const selects: string[] = [];
  for (const key of layerKeys) {
    selects.push(layerSelect(key));
  }
  if (referenceKeys.length) selects.push(referenceSelect(referenceKeys));
  if (wantAdmin) selects.push(adminSelect());

  if (!selects.length) return [];

  const { rows } = await pool.query(
    `${selects.join(' UNION ALL ')} ORDER BY sim DESC, name ASC LIMIT $2`,
    [q, limit]
  );

  return rows.map((r) => ({
    layerKey: r.layer_key as SearchHit['layerKey'],
    featureId: r.feature_id,
    name: r.name,
    source: r.source as SearchHit['source'],
    lonLat: [Number(r.lon), Number(r.lat)],
  }));
}
