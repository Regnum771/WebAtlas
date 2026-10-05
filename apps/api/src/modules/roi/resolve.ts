import {
  REGION_PROVINCE_CODES,
  type AdminLevel,
  type EditableLayerKey,
  type GeoJsonGeometry,
  type ResolvedRoi,
  type Roi,
  type RoiKind,
  type RoiMeasure,
} from '@webatlas/shared';
import { NotFoundError, ValidationError } from '../../errors';
import { simplifiedGeoJsonSql } from '../../lib/resultGeometry';
import { resolveFeature, type Queryable } from '../assistant/tools/data/helpers';
import {
  MAX_ROI_AREA_KM2,
  MAX_SOURCE_ENTITY_PARTS,
  MAX_SOURCE_ENTITY_VERTICES,
  REGION_SQL,
} from '../analysis/area';
import { MAX_INPUT_VERTICES } from '../analysis/geometryInput';

export interface RoiFacts {
  admin?: { level: AdminLevel; code: string };
  feature?: { layerKey: EditableLayerKey; featureId: string };
}

export interface RoiResolution {
  resolved: ResolvedRoi;
  /** Full precision, EPSG:4326, after the radius and the working-region clip. */
  geojson: string;
  /** What the operations need to know about the source (the stamped-code path, Gần nhất's exclusion). */
  facts: RoiFacts;
}

interface Source {
  geojson: string;
  label: string;
  facts: RoiFacts;
  /**
   * False for admin units: they are selected by code from the six working provinces,
   * so they are inside the region by construction, and Khánh Hoà alone (5,195 vertices
   * stored, 5,031 as resolved, in 164 parts) would trip the resulting-vertex cap. No operation feeds an admin unit's
   * full geometry to an expensive geometric step: Chọn trong vùng counts it by stamped
   * codes, elevation statistics refuses every province on area, the largest ward is
   * 2,253 vertices, and Gần nhất uses the centroid.
   */
  bounded: boolean;
}

const vn = (n: number) => n.toLocaleString('vi-VN');
const REGION_CODES = [...REGION_PROVINCE_CODES];

async function featureSource(db: Queryable, layerKey: EditableLayerKey, featureId: string, suffix = ''): Promise<Source> {
  const f = await resolveFeature(db, layerKey, featureId, { simplify: false });
  if (!f) throw new NotFoundError('Đối tượng không còn tồn tại');
  return {
    geojson: JSON.stringify(f.geometry),
    label: `${f.name ?? 'Đối tượng không tên'}${suffix}`,
    facts: { feature: { layerKey, featureId } },
    bounded: true,
  };
}

/** The level-1 river a way belongs to (FR-13), or the way itself when it has none. */
async function wholeRiverSource(db: Queryable, wayId: string): Promise<Source> {
  const { rows: [w] } = await db.query<{ parent: string | null }>(
    `SELECT parent_external_id AS parent FROM water.rivers_active WHERE id = $1`,
    [wayId]
  );
  if (!w) throw new NotFoundError('Đối tượng không còn tồn tại');

  if (w.parent) {
    const { rows: [r] } = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM water.rivers_active WHERE external_id = $1 AND feature_level = 1`,
      [w.parent]
    );
    if (r) return featureSource(db, 'rivers', r.id);
  }
  // 27 names have ways but no matched reach (Phase 3, Deviation 3): no river to return,
  // so the way itself — labelled as a segment rather than failing the pick.
  return featureSource(db, 'rivers', wayId, ' (đoạn)');
}

async function referenceSource(db: Queryable, layer: string, entityId: string): Promise<Source> {
  const { rows: [e] } = await db.query<{ name: string | null; geojson: string }>(
    `SELECT coalesce(ref, name) AS name, ST_AsGeoJSON(geom, 7) AS geojson
       FROM basemap.reference_entities WHERE layer_key = $1 AND entity_id = $2`,
    [layer, entityId]
  );
  if (!e) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');
  return { geojson: e.geojson, label: e.name ?? 'Thực thể không tên', facts: {}, bounded: true };
}

async function adminSource(db: Queryable, level: AdminLevel, code: string): Promise<Source> {
  const sql = level === 'province'
    ? `SELECT coalesce(full_name, name) AS name, ST_AsGeoJSON(geom, 7) AS geojson,
              code = ANY($2::text[]) AS "inRegion"
         FROM admin.provinces WHERE code = $1`
    : `SELECT coalesce(full_name, name) AS name, ST_AsGeoJSON(geom, 7) AS geojson,
              province_code = ANY($2::text[]) AS "inRegion"
         FROM admin.wards WHERE code = $1`;
  const { rows: [u] } = await db.query<{ name: string; geojson: string; inRegion: boolean }>(sql, [code, REGION_CODES]);
  if (!u) throw new NotFoundError('Không tìm thấy đơn vị hành chính');
  if (!u.inRegion) throw new ValidationError('Đơn vị hành chính này nằm ngoài vùng công tác.');
  return { geojson: u.geojson, label: u.name, facts: { admin: { level, code } }, bounded: false };
}

/**
 * A drawn shape comes from the browser, so PostGIS is asked whether it is valid before any
 * overlay runs: a self-intersecting polygon crossing the region edge otherwise raises a
 * GEOS TopologyException, which surfaces as a 500 on a public endpoint.
 */
async function drawnSource(db: Queryable, geometry: GeoJsonGeometry): Promise<Source> {
  const geojson = JSON.stringify(geometry);
  const { rows: [v] } = await db.query<{ ok: boolean }>(
    `SELECT ST_IsValid(ST_GeomFromGeoJSON($1)) AS ok`, [geojson]
  );
  if (!v.ok) {
    throw new ValidationError(
      geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'
        ? 'Vùng tự cắt nhau — hãy vẽ lại'
        : 'Hình vẽ không hợp lệ — hãy vẽ lại'
    );
  }
  return { geojson, label: 'Hình vẽ', facts: {}, bounded: true };
}

function sourceOf(db: Queryable, roi: Roi): Promise<Source> {
  switch (roi.source) {
    case 'drawn':
      return drawnSource(db, roi.geometry);
    case 'feature':
      return roi.whole ? wholeRiverSource(db, roi.featureId) : featureSource(db, roi.layerKey, roi.featureId);
    case 'reference':
      return referenceSource(db, roi.referenceLayer, roi.entityId);
    case 'admin':
      return adminSource(db, roi.level, roi.code);
  }
}

interface ShapeRow {
  sourceDim: number; sourceVertices: number; sourceParts: number; outDim: number;
  refused: boolean; empty: boolean; noRegion: boolean;
  geojson: string | null; display: GeoJsonGeometry | null;
  areaKm2: number | null; lengthKm: number | null; vertices: number | null;
  cx: number | null; cy: number | null;
  west: number | null; south: number | null; east: number | null; north: number | null;
}

const KIND_BY_DIM: Record<number, RoiKind> = { 0: 'point', 1: 'line', 2: 'area' };
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turn an ROI into geometry (spec §10). The ONLY place this happens: every analysis
 * operation calls it first, and POST /api/roi/resolve exposes it to the browser, so the
 * chip never shows an ROI a tool would then refuse (NFR-2).
 *
 * The source-vertex and part limits apply when a radius is given (they guard ST_Buffer);
 * without one the source is only bound by the resulting-vertex ceiling.
 *
 * Order of the checks matters, and matches the old area.ts: the source-complexity guard
 * runs INSIDE the SQL (a CASE that never evaluates ST_Buffer for an oversized source —
 * buffering the 22,662-point Quốc lộ 14 once OOM-killed a backend), then the working-
 * region clip, the area ceiling, and the resulting-vertex ceiling.
 */
export async function resolveRoi(db: Queryable, roi: Roi): Promise<RoiResolution> {
  const src = await sourceOf(db, roi);
  const radiusKm = roi.source === 'admin' ? null : roi.radiusKm ?? null;
  // Admin units are inside the region by construction (adminSource), so they skip the
  // union and the clip; everything else is clipped to the six provinces. The union is
  // computed once and joined in. A shape already covered by the region is kept as is:
  // GEOS 3.9.0's overlay returns EMPTY for an exactly horizontal or vertical line lying
  // wholly inside the region, while ST_CoveredBy answers correctly (and this also skips
  // the costly overlay in the common case).
  const clip = src.bounded
    ? `CASE WHEN ST_CoveredBy(s.g, rg.g) THEN s.g
            ELSE ST_CollectionExtract(ST_Intersection(s.g, rg.g), s.outdim + 1) END`
    : 's.g';
  const regionJoin = src.bounded ? `CROSS JOIN (${REGION_SQL}) rg` : '';

  const { rows: [row] } = await db.query<ShapeRow>(
    // src and shaped are MATERIALIZED too: with bound parameters the planner constant-folds
    // an inlined CTE once per reference, so the ST_Buffer ran ~3 times at plan time
    // (measured: 330 ms per resolve, 150 ms once materialised).
    `WITH src AS MATERIALIZED (
       SELECT g, ST_Dimension(g) AS dim, ST_NPoints(g) AS npoints, ST_NumGeometries(g) AS nparts
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) raw
     ),
     shaped AS MATERIALIZED (
       SELECT dim, npoints, nparts,
              CASE WHEN $2::float8 IS NULL THEN dim ELSE 2 END AS outdim,
              CASE WHEN $2::float8 IS NULL THEN g
                   WHEN dim = 2 THEN NULL::geometry
                   WHEN npoints > ${MAX_SOURCE_ENTITY_VERTICES} OR nparts > ${MAX_SOURCE_ENTITY_PARTS}
                     THEN NULL::geometry
                   -- Buffer a copy simplified to 1 % of the radius: the offset curve of a
                   -- 2,500-point river is the dominant cost, and the buffer's outline moves by
                   -- at most the tolerance, i.e. 1 % of the radius. The tolerance is $2 km * 1000
                   -- m * 0.01 = $2 * 10 m, converted to degrees at the source's latitude.
                   -- npoints / nparts stay on the original so the guards are unchanged.
                   ELSE ST_Buffer(
                          ST_SimplifyPreserveTopology(
                            g, ($2 * 10.0) / (111320.0 * cos(radians(ST_Y(ST_Centroid(g)))))
                          )::geography,
                          $2 * 1000)::geometry END AS g
         FROM src
     ),
     -- MATERIALIZED: g is read a dozen times below; without it each reference would
     -- re-run the whole buffer-and-clip expression (see the old area.ts, same reason).
     clipped AS MATERIALIZED (
       SELECT dim, npoints, nparts, outdim,
              ${src.bounded ? '(rg.g IS NULL)' : 'false'} AS noregion,
              CASE WHEN s.g IS NULL THEN NULL::geometry ELSE ${clip} END AS g
         FROM shaped s ${regionJoin}
     )
     SELECT noregion AS "noRegion", dim AS "sourceDim", npoints AS "sourceVertices", nparts AS "sourceParts", outdim AS "outDim",
            g IS NULL AS refused, (g IS NULL OR ST_IsEmpty(g)) AS empty,
            ST_AsGeoJSON(g, 7) AS geojson,
            CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ${simplifiedGeoJsonSql('g')} END AS display,
            (ST_Area(g::geography) / 1e6)::float8 AS "areaKm2",
            (ST_Length(g::geography) / 1000)::float8 AS "lengthKm",
            ST_NPoints(g) AS vertices,
            ST_X(ST_Centroid(g)) AS cx, ST_Y(ST_Centroid(g)) AS cy,
            ST_XMin(g) AS west, ST_YMin(g) AS south, ST_XMax(g) AS east, ST_YMax(g) AS north
       FROM clipped`,
    [src.geojson, radiusKm]
  );

  // admin.working_region holds a NULL geometry until the boundaries are seeded.
  if (row.noRegion) throw new Error('admin.working_region is empty: seed the admin boundaries first');
  if (row.refused) {
    if (row.sourceDim === 2) {
      throw new ValidationError('Vùng đã có diện tích, không cần bán kính.');
    }
    const reasons: string[] = [];
    if (row.sourceVertices > MAX_SOURCE_ENTITY_VERTICES) {
      reasons.push(`${vn(row.sourceVertices)} điểm vượt giới hạn ${vn(MAX_SOURCE_ENTITY_VERTICES)} điểm cho thực thể nguồn`);
    }
    if (row.sourceParts > MAX_SOURCE_ENTITY_PARTS) {
      reasons.push(`${vn(row.sourceParts)} phần rời rạc vượt giới hạn ${vn(MAX_SOURCE_ENTITY_PARTS)} phần cho thực thể nguồn`);
    }
    throw new ValidationError(
      `Thực thể quá phức tạp để tạo vùng đệm: ${reasons.join('; ')}. Hãy chọn thực thể khác hoặc bỏ bán kính.`
    );
  }
  if (row.empty) throw new ValidationError('Vùng phân tích nằm ngoài vùng công tác.');

  const kind = KIND_BY_DIM[row.outDim];
  if (kind === 'area' && row.areaKm2! > MAX_ROI_AREA_KM2) {
    throw new ValidationError(
      `Vùng phân tích quá lớn: ${vn(Math.round(row.areaKm2!))} km² vượt giới hạn diện tích ` +
        `${vn(MAX_ROI_AREA_KM2)} km². Hãy giảm bán kính hoặc chọn vùng nhỏ hơn.`
    );
  }
  if (src.bounded && row.vertices! > MAX_INPUT_VERTICES) {
    throw new ValidationError(
      `Vùng phân tích quá phức tạp: ${vn(row.vertices!)} điểm vượt giới hạn ${vn(MAX_INPUT_VERTICES)} điểm.`
    );
  }

  const measure: RoiMeasure =
    kind === 'area' ? { areaKm2: round3(row.areaKm2!) }
      : kind === 'line' ? { lengthKm: round3(row.lengthKm!) }
        : null;

  return {
    geojson: row.geojson!,
    facts: src.facts,
    resolved: {
      label: radiusKm === null ? src.label : `${src.label} + ${vn(radiusKm)} km`,
      kind,
      measure,
      display: row.display!,
      bbox: [row.west!, row.south!, row.east!, row.north!],
      centroid: [row.cx!, row.cy!],
    },
  };
}
