import { capResultItems, type AnalysisResult, type GeoJsonGeometry, type ResultGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { roiFromParts } from '../../roi/fromParts';
import { resolveRoi } from '../../roi/resolve';
import type { BufferInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/** Geodesic buffer (::geography), so a 10 km radius is 10 km at any latitude. */
export async function bufferOp(db: Queryable, input: BufferInput): Promise<AnalysisResult> {
  // The source goes through resolveRoi like every input (spec §10); the buffer itself is
  // this op's own work. Its body keeps the pre-ROI shape — only buffer_feature calls it.
  const { geojson, resolved } = await resolveRoi(db, roiFromParts(input));
  const src = { geojson, label: resolved.label };
  const { rows } = await db.query<{ input: GeoJsonGeometry; result: GeoJsonGeometry; areaKm2: number }>(
    `WITH b AS (SELECT ${GEOM} AS src, ST_Buffer(${GEOM}::geography, $2)::geometry AS buf)
     SELECT ${simplifiedGeoJsonSql('src')} AS input,
            ${simplifiedGeoJsonSql('buf')} AS result,
            round((ST_Area(buf::geography) / 1e6)::numeric, 3)::float8 AS "areaKm2"
       FROM b`,
    [src.geojson, input.radiusKm * 1000]
  );
  const row = rows[0];
  const items: ResultGeometry[] = [
    { geometry: row.result, role: 'result', label: `Vùng đệm ${input.radiusKm} km` },
    { geometry: row.input, role: 'input', ...(src.label ? { label: src.label } : {}) },
  ];
  const capped = capResultItems(items);
  return {
    op: 'buffer',
    summary: { 'Bán kính (km)': input.radiusKm, 'Diện tích vùng đệm (km²)': row.areaKm2 },
    geometries: capped.items,
    truncated: capped.truncated,
  };
}
