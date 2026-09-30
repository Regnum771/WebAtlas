import { REGION_PROVINCE_CODES } from '@webatlas/shared';

/**
 * The ceiling on an ROI's area, in km2.
 *
 * Quốc lộ 14 dissolved end to end is ~1,000 km of line; at the 100 km maximum
 * radius its buffer would cover most of the country and put every downstream op
 * past the 5s analysis budget. The six working-region provinces together measure
 * 103,198.50 km2 (union, measured), so this permits a genuinely large ROI --
 * roughly a quarter of the working region -- while refusing the runaway ones.
 * The message must name WHICH limit was hit (spec §4).
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
export const REGION_SQL = `
  SELECT ST_Union(geom) AS g FROM admin.provinces
   WHERE code = ANY(ARRAY[${REGION_PROVINCE_CODES.map((c) => `'${c}'`).join(',')}])`;
