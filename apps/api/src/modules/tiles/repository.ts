import type { Pool } from 'pg';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

export const TILE_LAYERS = ['rivers', 'lakes', 'rivers_overview', 'wards', 'provinces'] as const;
export type TileLayer = (typeof TILE_LAYERS)[number];
/** The administrative boundary layers: plain tables with no version chain. */
export type BoundaryLayer = 'wards' | 'provinces';

/** Where each tile layer's rows come from: the active-state views (S1), so the partial indexes serve the tile envelope. */
const SOURCE: Record<Exclude<TileLayer, BoundaryLayer>, string> = {
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
  if (layer === 'provinces') return provincesTileSql();
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
 * A boundary tile holds two MVT layers. `polyLayer` holds the clipped polygons; `labelLayer` holds one
 * point per unit, kept only in the tile that contains it, so the label is drawn once and not once per
 * tile. The containment test is half-open (min inclusive, max exclusive in x; the reverse in y, which
 * grows upwards in EPSG:3857) so a point on a shared edge lands in exactly one tile.
 * `source` lists the table columns read (alias `t`); `columns` are the polygon properties (camelCase,
 * like the GeoJSON files these tiles replace), `labelPoint` is the SQL for a unit's label point and
 * `polyGeom` the 4326 geometry the polygon is cut from (default: the stored one), all written
 * against the alias `h`.
 */
function boundaryTileSql(o: {
  table: string; polyLayer: string; labelLayer: string; source: string; columns: string; labelPoint: string; polyGeom?: string;
}): string {
  return `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
    hit AS (
      SELECT ${o.source}
        FROM ${o.table} t, bounds
       WHERE t.geom && ST_Transform(bounds.b, 4326)
    ),
    polys AS (
      SELECT ST_AsMVTGeom(ST_Transform(${o.polyGeom ?? 'h.geom'}, 3857), bounds.b, 4096, 64, true) AS geom, ${o.columns}
        FROM hit h, bounds
    ),
    pts AS (
      SELECT ST_Transform(${o.labelPoint}, 3857) AS p, h.code, h.name FROM hit h
    ),
    labels AS (
      SELECT ST_AsMVTGeom(pts.p, bounds.b, 4096, 0, false) AS geom, pts.code, pts.name
        FROM pts, bounds
       WHERE ST_X(pts.p) >= ST_XMin(bounds.b) AND ST_X(pts.p) < ST_XMax(bounds.b)
         AND ST_Y(pts.p) > ST_YMin(bounds.b) AND ST_Y(pts.p) <= ST_YMax(bounds.b)
    )
    SELECT (SELECT COALESCE(ST_AsMVT(polys.*, '${o.polyLayer}', 4096, 'geom'), ''::bytea) FROM polys WHERE geom IS NOT NULL)
        || (SELECT COALESCE(ST_AsMVT(labels.*, '${o.labelLayer}', 4096, 'geom'), ''::bytea) FROM labels WHERE geom IS NOT NULL) AS tile`;
}

/** Ward boundaries: the `wards` polygons and the `ward_labels` points (a point on the ward's surface). */
function wardsTileSql(): string {
  return boundaryTileSql({
    table: 'admin.wards', polyLayer: 'wards', labelLayer: 'ward_labels',
    source: 't.code, t.province_code, t.name, t.name_en, t.full_name, t.area_km2, t.geom',
    columns: `h.code, h.province_code AS "provinceCode", h.name, h.name_en AS "nameEn",
             h.full_name AS "fullName", NULL::text AS "fullNameEn", h.area_km2 AS "areaKm2"`,
    labelPoint: 'ST_PointOnSurface(h.geom)',
  });
}

/**
 * A point on the largest part of a multipolygon. A province with islands is labelled on its mainland,
 * which is where the web app put the label when it drew provinces from a GeoJSON file. Ties on area
 * fall to the part that comes first, so the point is the same on every request.
 */
export function largestPartPointSql(geom: string): string {
  return `ST_PointOnSurface((SELECT d.geom FROM ST_Dump(${geom}) d ORDER BY ST_Area(d.geom) DESC, d.path LIMIT 1))`;
}

/**
 * Province boundaries: the `provinces` polygons and the `province_labels` points (largest part).
 *
 * The polygons are simplified to half a screen pixel of the tile's zoom before they are cut (a tile
 * is drawn 512 px wide, so a pixel is 360 / (512 * 2^z) degrees). ST_AsMVTGeom alone keeps every
 * vertex that falls on a different cell of its 4096 grid, an eighth of a pixel: a country-wide tile
 * then carries tens of thousands of coastline vertices nobody can see, and the browser pays for
 * decoding and drawing them. The label point is still taken from the stored geometry.
 */
function provincesTileSql(): string {
  return boundaryTileSql({
    polyGeom: 'ST_Simplify(h.geom, 180.0 / (512 * 2 ^ $1::int))',
    table: 'admin.provinces', polyLayer: 'provinces', labelLayer: 'province_labels',
    source: 't.code, t.name, t.name_en, t.full_name, t.area_km2, t.geom',
    columns: `h.code, h.name, h.name_en AS "nameEn", h.full_name AS "fullName",
             NULL::text AS "fullNameEn", h.area_km2 AS "areaKm2"`,
    labelPoint: largestPartPointSql('h.geom'),
  });
}

export type VersionedLayer = 'rivers' | 'lakes' | BoundaryLayer;
export interface TileVersions { rivers: string | null; lakes: string | null; wards: string | null; provinces: string | null }

/** The version token that keys each tile layer's URLs (the far-zoom rivers are drawn from the rivers version). */
export const VERSION_OF: Record<TileLayer, VersionedLayer> = {
  rivers: 'rivers', rivers_overview: 'rivers', lakes: 'lakes', wards: 'wards', provinces: 'provinces',
};

/** The active dataset version ids of rivers and lakes (one cheap lookup). */
async function datasetVersions(db: Pool): Promise<{ rivers: string | null; lakes: string | null }> {
  const { rows } = await db.query<{ layer_key: 'rivers' | 'lakes'; id: string }>(
    `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers', 'lakes')`);
  const out = { rivers: null as string | null, lakes: null as string | null };
  for (const r of rows) out[r.layer_key] = r.id;
  return out;
}

const BOUNDARY_TOKEN_TTL_MS = 60_000;
const BOUNDARY_TABLE: Record<BoundaryLayer, string> = { wards: 'admin.wards', provinces: 'admin.provinces' };
const boundaryTokens = new Map<BoundaryLayer, { value: string | null; at: number }>();

/** Test hook: forget the cached boundary tokens. */
export function resetBoundaryTokenCache(): void { boundaryTokens.clear(); }

/**
 * Wards and provinces have no version chain, so their token is an md5 over every row's code, names,
 * full geometry digest and area: any change to the table changes it. The digest scans all geometries
 * (tens to hundreds of ms), so it is cached in-process for 60 s (a concurrent miss may compute twice,
 * which is harmless). A short cache is safe: a boundary replacement takes effect within 60 s, and a
 * stale token can only mark NEW data immutable under an OLD URL, which clients stop requesting once
 * they re-read /api/tiles/versions; it can never put old data under a new URL.
 */
export async function boundaryVersion(db: Pool, layer: BoundaryLayer): Promise<string | null> {
  const cached = boundaryTokens.get(layer);
  if (cached && Date.now() - cached.at < BOUNDARY_TOKEN_TTL_MS) return cached.value;
  const { rows } = await db.query<{ token: string | null }>(
    `SELECT md5(string_agg(code || ':' || name || ':' || coalesce(full_name, '') || ':' || md5(ST_AsEWKB(geom))
                             || ':' || coalesce(area_km2::text, ''), ',' ORDER BY code)) AS token
       FROM ${BOUNDARY_TABLE[layer]}`);
  const value = rows[0]?.token ?? null;
  boundaryTokens.set(layer, { value, at: Date.now() });
  return value;
}

/** The version token of one layer: only what that layer needs is computed. */
export async function versionOf(db: Pool, layer: VersionedLayer): Promise<string | null> {
  return layer === 'wards' || layer === 'provinces' ? boundaryVersion(db, layer) : (await datasetVersions(db))[layer];
}

/** All tokens, for GET /api/tiles/versions. */
export async function activeVersions(db: Pool): Promise<TileVersions> {
  const [d, wards, provinces] = await Promise.all([datasetVersions(db), boundaryVersion(db, 'wards'), boundaryVersion(db, 'provinces')]);
  return { ...d, wards, provinces };
}
