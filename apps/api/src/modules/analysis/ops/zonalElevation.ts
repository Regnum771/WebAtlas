import { FABDEM_ATTRIBUTION, type AnalysisResult } from '@webatlas/shared';
import { ValidationError } from '../../../errors';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { areaGeometry } from '../area';
import { DEM_UNAVAILABLE_SUMMARY, demAvailable } from '../dem';
import type { ZonalInput } from '../schemas';

/** ~5.5M 30 m pixels — a few seconds at most; anything bigger belongs in a batch job. */
export const MAX_ZONAL_AREA_KM2 = 5000;

export async function zonalElevationOp(db: Queryable, input: ZonalInput): Promise<AnalysisResult> {
  const area = await areaGeometry(db, input as ZonalInput & { bufferKm?: number });
  if (area.areaKm2 > MAX_ZONAL_AREA_KM2) {
    throw new ValidationError(`Vùng quá lớn (${Math.round(area.areaKm2)} km²); tối đa ${MAX_ZONAL_AREA_KM2} km².`);
  }
  const drawn = [{ geometry: area.display, role: 'input' as const, ...(area.label ? { label: area.label } : {}) }];
  if (!(await demAvailable(db))) {
    return { op: 'zonal_elevation', summary: { ...DEM_UNAVAILABLE_SUMMARY }, geometries: drawn };
  }

  const { rows: [s] } = await db.query<{ count: number | null; min: number | null; max: number | null; mean: number | null }>(
    `WITH area AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          clipped AS (
            SELECT ST_Clip(r.rast, area.g, true) AS rast
              FROM basemap.dem_region r, area
             WHERE ST_Intersects(r.rast, area.g)),
          stats AS (SELECT ST_SummaryStatsAgg(rast, 1, true) AS st FROM clipped WHERE rast IS NOT NULL)
     SELECT (st).count::int AS count, round((st).min::numeric, 1)::float8 AS min,
            round((st).max::numeric, 1)::float8 AS max, round((st).mean::numeric, 1)::float8 AS mean
       FROM stats`,
    [area.geojson]
  );

  const summary: Record<string, number | string> = { 'Diện tích (km²)': Math.round(area.areaKm2 * 1000) / 1000 };
  if (!s || !s.count) {
    summary['Trạng thái'] = 'Không có dữ liệu độ cao trong vùng';
  } else {
    Object.assign(summary, {
      'Thấp nhất (m)': s.min!, 'Cao nhất (m)': s.max!, 'Trung bình (m)': s.mean!, 'Số điểm ảnh': s.count,
    });
  }
  return { op: 'zonal_elevation', summary, geometries: drawn, attribution: FABDEM_ATTRIBUTION };
}
