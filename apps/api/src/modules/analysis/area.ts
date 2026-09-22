import { REGION_PROVINCE_CODES, type GeoJsonGeometry } from '@webatlas/shared';
import { NotFoundError, ValidationError } from '../../errors';
import { simplifiedGeoJsonSql } from '../../lib/resultGeometry';
import { getReferenceLayer } from '../../reference/registry';
import { resolveFeature, type Queryable } from '../assistant/tools/data/helpers';
import { MAX_INPUT_VERTICES, type FeatureRefInput, type ReferenceRefInput } from './schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/**
 * The ceiling on an ROI's area, in km2.
 *
 * Quốc lộ 14 dissolved end to end is ~1,000 km of line; at the 100 km maximum
 * radius its buffer would cover most of the country and put every downstream op
 * past the 5s analysis budget. The six working-region provinces together are on
 * the order of 50,000 km2, so this permits a genuinely large ROI while refusing
 * the runaway ones. The message must name WHICH limit was hit (spec §4).
 */
export const MAX_ROI_AREA_KM2 = 25_000;

/**
 * The ceiling on a reference ENTITY's own vertex count, checked before any
 * ST_Buffer runs on it. This is distinct from MAX_INPUT_VERTICES below, which
 * bounds the RESULTING ROI after buffering/clipping -- both existing limits
 * (this file's MAX_ROI_AREA_KM2 and schemas.ts's MAX_INPUT_VERTICES) are
 * measured on the buffered/clipped output, so neither can stop an oversized
 * buffer from running in the first place. Buffering the 647-part Quốc lộ 14 -
 * Đường Hồ Chí Minh entity (22,662 points) by its allowed maximum of 100 km
 * OOM-killed a Postgres backend (signal 9) before the 5s statement_timeout
 * could cancel it. Measured per-layer p99 point counts in the live dev
 * database: landuse 241, places 2, railways 3,801, roads 650, water 6,232.
 * 10,000 sits above every layer's p99 -- water's 6,232 is the highest --
 * while still refusing that pathological roads entity.
 *
 * Vertex count alone is NOT a reliable proxy for ST_Buffer's cost, though:
 * its cost is driven by the segments in the offset curve, which for a
 * fragmented multi-part geometry is dominated by PART count, not point
 * count -- each disjoint part contributes its own two round end caps and its
 * own disc to union into the result. The Hoài Nhơn - Quy Nhơn expressway
 * (roads:54958598e3554c044cafca823a92555d:0) is 9,050 points across 1,726
 * disjoint OSM segments under one name/ref -- comfortably under this vertex
 * ceiling, yet its buffer generates roughly as much offset-curve geometry as
 * the entity that actually OOM-killed Postgres (~70k segments/caps vs.
 * ~65k). That is why MAX_SOURCE_ENTITY_PARTS exists as a second, independent
 * term below: bounding points alone leaves this exact entity reachable via
 * a 100 km buffer request.
 */
export const MAX_SOURCE_ENTITY_VERTICES = 10_000;

/**
 * The ceiling on a reference ENTITY's own part count (ST_NumGeometries),
 * checked alongside MAX_SOURCE_ENTITY_VERTICES above and for the same reason
 * -- before any ST_Buffer runs. See that constant's comment for why part
 * count, not vertex count, is ST_Buffer's real cost driver for a fragmented
 * multi-part geometry.
 *
 * Measured against the live dev database (20,913 reference entities across
 * all layers): exactly one entity has <= MAX_SOURCE_ENTITY_VERTICES points
 * AND more than 300 parts -- the Hoài Nhơn - Quy Nhơn expressway above
 * (1,726 parts, 9,050 points). So a ceiling of 300 closes the hole this
 * constant exists for at the cost of refusing that one entity as a buffer
 * source; every other entity under the vertex ceiling is also under 300
 * parts. Verified with:
 *   SELECT count(*) FROM basemap.reference_entities
 *    WHERE ST_NPoints(geom) <= 10000 AND ST_NumGeometries(geom) > 300;
 * -- returns 1.
 */
export const MAX_SOURCE_ENTITY_PARTS = 300;

/** Union of the six working-region provinces; an ROI is clipped to it. */
const REGION_SQL = `
  SELECT ST_Union(geom) AS g FROM admin.provinces
   WHERE code = ANY(ARRAY[${REGION_PROVINCE_CODES.map((c) => `'${c}'`).join(',')}])`;

/**
 * A reference entity's geometry, buffered if a radius was given, clipped to the
 * working region, and refused if it is too big to analyse.
 */
async function referenceGeometry(
  db: Queryable,
  ref: ReferenceRefInput
): Promise<{ geojson: string; label?: string }> {
  const def = getReferenceLayer(ref.referenceLayer);

  // Checked before the query: it depends only on the layer's geometry kind and the
  // caller's input, so there is nothing to look up. Lines and points have no area
  // of their own — the panel should have asked for a radius (spec §5's radius
  // prompt). Say which input is missing rather than failing obscurely later.
  if (ref.radiusKm === undefined && def.geomKind !== 'area') {
    throw new ValidationError(
      'Thực thể dạng đường hoặc điểm cần bán kính (radiusKm) để thành vùng.'
    );
  }

  const { rows } = await db.query<{
    geojson: string | null; name: string | null; type: string; areaKm2: number; vertices: number;
    sourceVertices: number; sourceParts: number;
  }>(
    `WITH region AS (${REGION_SQL}),
          e AS (
            -- ST_NPoints/ST_NumGeometries on the raw fetched geometry, before any
            -- buffering: this is what the CASE below tests so the ST_Buffer branch is
            -- never evaluated for an entity that fails either complexity check (SQL
            -- CASE evaluates only the matching WHEN branch, per row).
            SELECT name, ref, geom, ST_NPoints(geom) AS npoints, ST_NumGeometries(geom) AS nparts
              FROM basemap.reference_entities
             WHERE layer_key = $1 AND entity_id = $2
          ),
          shaped AS (
            SELECT coalesce(e.ref, e.name) AS name, e.npoints, e.nparts,
                   CASE WHEN $3::float8 IS NULL THEN e.geom
                        WHEN e.npoints > ${MAX_SOURCE_ENTITY_VERTICES}
                          OR e.nparts > ${MAX_SOURCE_ENTITY_PARTS} THEN NULL::geometry
                        ELSE ST_Buffer(e.geom::geography, $3 * 1000)::geometry END AS g
              FROM e
          ),
          -- MATERIALIZED: clipped.g is referenced four times below (ST_AsGeoJSON,
          -- GeometryType, ST_Area, ST_NPoints). Without this, Postgres inlines this
          -- single-reference CTE and pulls its subquery up into the outer SELECT, so
          -- each of those four references gets its own copy of the full
          -- ST_Intersection(CASE ... ST_Buffer ...) expression tree -- roughly 4x the
          -- peak memory for every buffer the guard above does allow. Materializing
          -- forces the CTE to be computed once and its result column reused.
          clipped AS MATERIALIZED (
            SELECT s.name, s.npoints, s.nparts, ST_Intersection(s.g, r.g) AS g
              FROM shaped s CROSS JOIN region r
          )
     SELECT ST_AsGeoJSON(g, 7) AS geojson, name,
            GeometryType(g) AS type,
            (ST_Area(g::geography) / 1e6)::float8 AS "areaKm2",
            ST_NPoints(g) AS vertices,
            npoints AS "sourceVertices",
            nparts AS "sourceParts"
       FROM clipped`,
    [ref.referenceLayer, ref.entityId, ref.radiusKm ?? null]
  );

  const row = rows[0];
  if (!row) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');

  // Checked before the "outside working region" check below, because a rejected
  // entity's geojson is also null (the CASE above returned NULL rather than
  // buffering it) -- without this ordering the caller would see the wrong,
  // generic message instead of one naming this specific limit (spec §4).
  // Two independent terms, matching the SQL CASE above: points and parts. Both
  // are real cost drivers (see MAX_SOURCE_ENTITY_VERTICES/_PARTS' comments), so
  // the message lists whichever one(s) this entity actually exceeded -- a user
  // who hits it should know whether to pick a shorter road or a less
  // fragmented one, not just that "something" was too complex.
  const overVertices = row.sourceVertices > MAX_SOURCE_ENTITY_VERTICES;
  const overParts = row.sourceParts > MAX_SOURCE_ENTITY_PARTS;
  if (ref.radiusKm !== undefined && (overVertices || overParts)) {
    const reasons: string[] = [];
    if (overVertices) {
      reasons.push(
        `${row.sourceVertices.toLocaleString('vi-VN')} điểm vượt giới hạn ` +
          `${MAX_SOURCE_ENTITY_VERTICES.toLocaleString('vi-VN')} điểm cho thực thể nguồn`
      );
    }
    if (overParts) {
      reasons.push(
        `${row.sourceParts.toLocaleString('vi-VN')} phần rời rạc vượt giới hạn ` +
          `${MAX_SOURCE_ENTITY_PARTS.toLocaleString('vi-VN')} phần cho thực thể nguồn`
      );
    }
    throw new ValidationError(
      `Thực thể quá phức tạp để tạo vùng đệm: ${reasons.join('; ')}. ` +
        `Hãy chọn thực thể khác hoặc bỏ bán kính.`
    );
  }

  // An entity that lies wholly outside the working region clips to empty.
  if (!row.geojson || row.vertices === 0) {
    throw new ValidationError('Thực thể này nằm ngoài vùng làm việc.');
  }

  if (row.areaKm2 > MAX_ROI_AREA_KM2) {
    throw new ValidationError(
      `Vùng quan tâm quá lớn: ${Math.round(row.areaKm2).toLocaleString('vi-VN')} km² ` +
        `vượt giới hạn diện tích ${MAX_ROI_AREA_KM2.toLocaleString('vi-VN')} km². ` +
        `Hãy giảm bán kính hoặc chọn thực thể nhỏ hơn.`
    );
  }

  if (row.vertices > MAX_INPUT_VERTICES) {
    throw new ValidationError(
      `Vùng quan tâm quá phức tạp: ${row.vertices.toLocaleString('vi-VN')} điểm ` +
        `vượt giới hạn ${MAX_INPUT_VERTICES.toLocaleString('vi-VN')} điểm.`
    );
  }

  return { geojson: row.geojson, ...(row.name ? { label: row.name } : {}) };
}

/** A drawn geometry as-is, a feature's full-precision geometry, or a reference entity. */
export async function inputGeometry(
  db: Queryable,
  input: { geometry?: GeoJsonGeometry; feature?: FeatureRefInput; reference?: ReferenceRefInput }
): Promise<{ geojson: string; label?: string }> {
  if (input.geometry) return { geojson: JSON.stringify(input.geometry) };
  if (input.reference) return referenceGeometry(db, input.reference);
  const ref = input.feature!;
  const f = await resolveFeature(db, ref.layerKey, ref.featureId, { simplify: false });
  if (!f) throw new NotFoundError('Không tìm thấy đối tượng');
  return { geojson: JSON.stringify(f.geometry), ...(f.name ? { label: f.name } : {}) };
}

/**
 * The polygon an area operation runs over: a drawn/feature polygon, or any
 * geometry buffered by `bufferKm`. A point or line with no buffer has no area,
 * which is a user error, not an empty result.
 */
export async function areaGeometry(
  db: Queryable,
  input: {
    geometry?: GeoJsonGeometry;
    feature?: FeatureRefInput;
    reference?: ReferenceRefInput;
    bufferKm?: number;
  }
): Promise<{ geojson: string; display: GeoJsonGeometry; label?: string; areaKm2: number }> {
  const src = await inputGeometry(db, input);
  const shapeSql = input.bufferKm !== undefined ? `ST_Buffer(${GEOM}::geography, $2)::geometry` : GEOM;
  const params = input.bufferKm !== undefined ? [src.geojson, input.bufferKm * 1000] : [src.geojson];
  const { rows } = await db.query<{ geojson: string; display: GeoJsonGeometry; type: string; areaKm2: number }>(
    `SELECT ST_AsGeoJSON(a, 7) AS geojson, ${simplifiedGeoJsonSql('a')} AS display,
            GeometryType(a) AS type,
            (ST_Area(a::geography) / 1e6)::float8 AS "areaKm2"
       FROM (SELECT ${shapeSql} AS a) s`,
    params
  );
  const row = rows[0];
  if (row.type !== 'POLYGON' && row.type !== 'MULTIPOLYGON') {
    throw new ValidationError('Vùng phải là đa giác; với điểm hoặc đường hãy nhập bán kính vùng đệm (bufferKm).');
  }
  const label = input.bufferKm !== undefined
    ? `${src.label ?? 'Hình vẽ'} + ${input.bufferKm} km`
    : src.label;
  return { geojson: row.geojson, display: row.display, areaKm2: row.areaKm2, ...(label ? { label } : {}) };
}
