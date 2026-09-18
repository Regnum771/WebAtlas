import { FABDEM_ATTRIBUTION, type AnalysisResult, type GeoJsonGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import type { Queryable } from '../../assistant/tools/data/helpers';
import { inputGeometry } from '../area';
import { DEM_UNAVAILABLE_SUMMARY, demAvailable } from '../dem';
import type { ProfileInput } from '../schemas';

const round1 = (n: number) => Math.round(n * 10) / 10;

export function profileStats(elevations: (number | null)[], lengthM: number) {
  const valid = elevations.filter((e): e is number => e !== null);
  if (valid.length === 0) return null;
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < valid.length; i++) {
    const d = valid[i] - valid[i - 1];
    if (d > 0) ascentM += d; else descentM -= d;
  }
  return {
    min: round1(Math.min(...valid)),
    max: round1(Math.max(...valid)),
    ascentM: round1(ascentM),
    descentM: round1(descentM),
    meanSlopePct: lengthM > 0 ? round1(((ascentM + descentM) / lengthM) * 100) : 0,
    valid: valid.length,
  };
}

/**
 * Samples the DEM at `samples` evenly spaced points along a line. A MultiLineString
 * (most rivers) is merged, and its longest part is profiled. Distances are the
 * geodesic length times the planar fraction — accurate to well under 1% over the
 * region's extent.
 */
export async function elevationProfileOp(db: Queryable, input: ProfileInput): Promise<AnalysisResult> {
  const src = await inputGeometry(db, input);

  // Independent of the DEM (pure PostGIS on the input line), so this runs before
  // the demAvailable check below — that way an unloaded DEM still draws the
  // user's line, the same as zonalElevationOp draws its input area.
  const { rows: [line] } = await db.query<{ line: string; lengthM: number; display: GeoJsonGeometry }>(
    `WITH src AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          part AS (
            SELECT d.geom AS g
              FROM src, LATERAL ST_Dump(
                CASE WHEN GeometryType(src.g) = 'MULTILINESTRING' THEN ST_LineMerge(src.g) ELSE src.g END
              ) d
             ORDER BY ST_Length(d.geom::geography) DESC
             LIMIT 1)
     SELECT ST_AsGeoJSON(g, 7) AS line, ST_Length(g::geography)::float8 AS "lengthM",
            ${simplifiedGeoJsonSql('g')} AS display
       FROM part`,
    [src.geojson]
  );
  const drawn = [{ geometry: line.display, role: 'result' as const, label: src.label ?? 'Trắc diện' }];

  if (!(await demAvailable(db))) {
    return { op: 'elevation_profile', summary: { ...DEM_UNAVAILABLE_SUMMARY }, geometries: drawn };
  }

  const { rows: samples } = await db.query<{ i: number; elevationM: number | null }>(
    `WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
          pts AS (
            SELECT s.i, ST_LineInterpolatePoint(line.g, s.i::float8 / ($2::int - 1)) AS p
              FROM line, generate_series(0, $2::int - 1) AS s(i))
     SELECT pts.i,
            (SELECT round(ST_Value(r.rast, pts.p)::numeric, 1)::float8
               FROM basemap.dem_region r
              -- Filter on ST_ConvexHull(r.rast) — not on r.rast directly — so this
              -- matches dem_region_rast_convexhull_idx (a GiST index on that exact
              -- expression) and runs as an index scan. The raw ST_Intersects(rast,
              -- point) form below it isn't indexable, so Postgres falls back to a
              -- sequential scan of every DEM tile per sample point: for a 100-sample
              -- profile that's 100 full scans of basemap.dem_region (~7,200 tiles),
              -- ~1.9s just for this step and the main cause of the 504s a ~5-6 km
              -- line at the default 100 samples hit (ANALYSIS_TIMEOUT_MS = 5000, see
              -- db.ts). Measured: ~1941ms (seq scan) vs ~103ms (index scan) for the
              -- same 100-sample, ~5.9 km query — see
              -- .superpowers/sdd/post-verification-fixes-report.md.
              WHERE ST_Intersects(ST_ConvexHull(r.rast), pts.p)
              LIMIT 1) AS "elevationM"
       FROM pts
      ORDER BY pts.i`,
    [line.line, input.samples]
  );

  const profile = samples.map((s) => ({
    distanceM: round1((line.lengthM * s.i) / (input.samples - 1)),
    elevationM: s.elevationM,
  }));
  const stats = profileStats(profile.map((p) => p.elevationM), line.lengthM);
  const summary: Record<string, number | string> = { 'Chiều dài (km)': Math.round(line.lengthM / 10) / 100 };
  if (stats) {
    Object.assign(summary, {
      'Thấp nhất (m)': stats.min,
      'Cao nhất (m)': stats.max,
      'Tổng lên (m)': stats.ascentM,
      'Tổng xuống (m)': stats.descentM,
      'Độ dốc trung bình (%)': stats.meanSlopePct,
      'Mẫu có dữ liệu': `${stats.valid}/${input.samples}`,
    });
  } else {
    summary['Trạng thái'] = 'Không có dữ liệu độ cao dọc tuyến';
  }

  return {
    op: 'elevation_profile',
    summary,
    profile,
    geometries: drawn,
    attribution: FABDEM_ATTRIBUTION,
  };
}
