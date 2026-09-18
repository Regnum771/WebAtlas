import { capResultItems, type AnalysisResult, type GeoJsonGeometry, type ResultGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { inputGeometry } from '../area';
import type { BufferInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/** Geodesic buffer (::geography), so a 10 km radius is 10 km at any latitude. */
export async function bufferOp(db: Queryable, input: BufferInput): Promise<AnalysisResult> {
  const src = await inputGeometry(db, input);
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
