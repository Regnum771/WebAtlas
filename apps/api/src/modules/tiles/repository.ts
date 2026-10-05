import type { Pool } from 'pg';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

export const TILE_LAYERS = ['rivers', 'lakes', 'rivers_overview', 'wards'] as const;
export type TileLayer = (typeof TILE_LAYERS)[number];

/** Where each tile layer's rows come from: the active-state views (S1), so the partial indexes serve the tile envelope. */
const SOURCE: Record<Exclude<TileLayer, 'wards'>, string> = {
  rivers: 'water.rivers_detail',
  lakes: 'water.lakes_active',
  rivers_overview: 'water.rivers_active',
};

/** The properties each tile feature carries: what the web app's styles, popups and ROI candidates read. */
function propertiesSql(layer: 'rivers' | 'lakes' | 'rivers_overview'): string {
  if (layer === 'rivers_overview') return 't.name_key, t.name, t.stream_order';
  const iso = Object.entries(LAYER_ATTRIBUTE_MAP[layer].attributes).map(([db, name]) => `t.${db} AS "${name}"`);
  return [`t.id::text AS id`, `'${layer}'::text AS "layerKey"`, ...iso].join(', ');
}

/**
 * One tile: $1 z, $2 x, $3 y. ST_AsMVTGeom clips to the tile (64-unit buffer, so line joins and
 * polygon edges do not show seams) and simplifies to its 4096-unit grid. The bounding-box test is
 * on the stored 4326 geometry, so the views' partial GiST index (migration 22) serves it.
 */
export function tileSql(layer: TileLayer): string {
  if (layer === 'wards') return wardsTileSql();
  if (layer === 'rivers_overview') return overviewTileSql();
  return `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
    features AS (
      SELECT ST_AsMVTGeom(ST_Transform(t.geom, 3857), bounds.b, 4096, 64, true) AS geom, ${propertiesSql(layer)}
        FROM ${SOURCE[layer]} t, bounds
       WHERE t.geom && ST_Transform(bounds.b, 4326)
    )
    SELECT ST_AsMVT(features.*, '${layer}', 4096, 'geom') AS tile FROM features WHERE geom IS NOT NULL`;
}

/**
 * Far-zoom rivers. Deliberately NOT read from water.rivers_overview: that view simplifies every river
 * before any filter, which defeats the bounding-box index and costs seconds per tile. This selects the
 * same rows (level-1 rivers having a level-3 way of stream order 5, as in migration 1000000000020) from
 * the active view and filters by the tile envelope first. Only the surviving rivers are simplified (0.01 degree,
 * like the view; plain ST_Simplify, since the topology-preserving variant is several times slower and a
 * tile does not need it), then clipped and quantised by ST_AsMVTGeom.
 */
function overviewTileSql(): string {
  return `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
    features AS (
      SELECT ST_AsMVTGeom(ST_Transform(ST_Simplify(t.geom, 0.01), 3857), bounds.b, 4096, 64, true) AS geom,
             COALESCE(t.name, '') AS name_key, t.name, t.stream_order
        FROM ${SOURCE.rivers_overview} t, bounds
       WHERE t.feature_level = 1
         AND t.geom && ST_Transform(bounds.b, 4326)
         AND t.external_id IN (SELECT parent_external_id FROM ${SOURCE.rivers_overview} WHERE feature_level = 3 AND stream_order = 5)
    )
    SELECT ST_AsMVT(features.*, 'rivers_overview', 4096, 'geom') AS tile FROM features WHERE geom IS NOT NULL`;
}

/**
 * Ward boundaries: two MVT layers in one tile. `wards` holds the clipped polygons; `ward_labels`
 * holds one point per ward (ST_PointOnSurface), kept only in the tile that contains it, so the label is
 * drawn once and not once per tile. The containment test is half-open (min inclusive, max exclusive in
 * x; the reverse in y, which grows upwards in EPSG:3857) so a point on a shared edge lands in exactly one tile.
 * Property names are camelCase, like the GeoJSON file this replaces.
 */
function wardsTileSql(): string {
  return `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
    hit AS (
      SELECT w.code, w.province_code, w.name, w.name_en, w.full_name, w.area_km2, w.geom
        FROM admin.wards w, bounds
       WHERE w.geom && ST_Transform(bounds.b, 4326)
    ),
    polys AS (
      SELECT ST_AsMVTGeom(ST_Transform(h.geom, 3857), bounds.b, 4096, 64, true) AS geom,
             h.code, h.province_code AS "provinceCode", h.name, h.name_en AS "nameEn",
             h.full_name AS "fullName", NULL::text AS "fullNameEn", h.area_km2 AS "areaKm2"
        FROM hit h, bounds
    ),
    pts AS (
      SELECT ST_Transform(ST_PointOnSurface(h.geom), 3857) AS p, h.code, h.name FROM hit h
    ),
    labels AS (
      SELECT ST_AsMVTGeom(pts.p, bounds.b, 4096, 0, false) AS geom, pts.code, pts.name
        FROM pts, bounds
       WHERE ST_X(pts.p) >= ST_XMin(bounds.b) AND ST_X(pts.p) < ST_XMax(bounds.b)
         AND ST_Y(pts.p) > ST_YMin(bounds.b) AND ST_Y(pts.p) <= ST_YMax(bounds.b)
    )
    SELECT (SELECT COALESCE(ST_AsMVT(polys.*, 'wards', 4096, 'geom'), ''::bytea) FROM polys WHERE geom IS NOT NULL)
        || (SELECT COALESCE(ST_AsMVT(labels.*, 'ward_labels', 4096, 'geom'), ''::bytea) FROM labels WHERE geom IS NOT NULL) AS tile`;
}

export interface TileVersions { rivers: string | null; lakes: string | null; wards: string | null }

/**
 * Rivers and lakes are keyed by their active dataset version. Wards have no version chain, so their
 * token is a hash over what a tile draws from admin.wards: code, name, area and a geometry digest
 * (vertex count plus bounding box), which changes whenever the table is replaced or a ward edited.
 */
export async function activeVersions(db: Pool): Promise<TileVersions> {
  const [{ rows }, wards] = await Promise.all([
    db.query<{ layer_key: 'rivers' | 'lakes'; id: string }>(
      `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers', 'lakes')`),
    db.query<{ token: string | null }>(
      `SELECT md5(string_agg(concat_ws('|', code, province_code, name, name_en, full_name, area_km2, ST_NPoints(geom), ST_AsText(Box2D(geom))), ';' ORDER BY code)) AS token
         FROM admin.wards`),
  ]);
  const out: TileVersions = { rivers: null, lakes: null, wards: wards.rows[0]?.token ?? null };
  for (const r of rows) out[r.layer_key] = r.id;
  return out;
}
