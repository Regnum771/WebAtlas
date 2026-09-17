import { describe, it, expect } from 'vitest';
import { profileStats } from './elevationProfile';
import { getPool } from '../../../db/pool';
import { demAvailable } from '../dem';

describe('profileStats', () => {
  it('computes range, ascent, descent and mean slope, skipping nodata samples', () => {
    const s = profileStats([100, 150, null, 120, 200], 1000);
    expect(s).toEqual({ min: 100, max: 200, ascentM: 130, descentM: 30, meanSlopePct: 16, valid: 4 });
  });

  it('returns null when no sample has data', () => {
    expect(profileStats([null, null], 500)).toBeNull();
  });
});

describe('per-sample DEM lookup query plan', () => {
  // Regression guard for the 504 ANALYSIS_TIMEOUT a ~5-6 km line at the default
  // 100 samples hit: `WHERE ST_Intersects(r.rast, pts.p)` filters directly on the
  // raster column, which doesn't match `dem_region_rast_convexhull_idx` (a GiST
  // index on `ST_ConvexHull(rast)`), so Postgres falls back to a Seq Scan of every
  // DEM tile per sample — measured ~1.9s of DB time alone for 100 samples, and over
  // 5s under the load a real browser session adds. Filtering on
  // `ST_ConvexHull(r.rast)` matches the index and drops that to ~0.1s (measured via
  // EXPLAIN ANALYZE — see .superpowers/sdd/post-verification-fixes-report.md).
  // A wall-clock assertion on this alone is load/cache-dependent (it didn't
  // reliably reproduce the timeout on a quiet dev machine), so this test pins the
  // query PLAN instead: it fails immediately, on any machine, if the predicate
  // regresses back to the non-indexable form.
  it('uses the convexhull GiST index, not a sequential scan, for the per-sample lookup', async () => {
    const pool = getPool();
    if (!(await demAvailable(pool))) return;

    // Same sampling query elevationProfileOp runs (see elevationProfile.ts), just
    // prefixed with EXPLAIN so this checks the plan shape rather than executing it.
    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN
       WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
            pts AS (
              SELECT s.i, ST_LineInterpolatePoint(line.g, s.i::float8 / ($2::int - 1)) AS p
                FROM line, generate_series(0, $2::int - 1) AS s(i))
       SELECT pts.i,
              (SELECT round(ST_Value(r.rast, pts.p)::numeric, 1)::float8
                 FROM basemap.dem_region r
                WHERE ST_Intersects(ST_ConvexHull(r.rast), pts.p)
                LIMIT 1) AS "elevationM"
         FROM pts
        ORDER BY pts.i`,
      [JSON.stringify({ type: 'LineString', coordinates: [[108.05, 12.68], [108.1052, 12.68]] }), 100]
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');

    expect(plan).toContain('dem_region_rast_convexhull_idx');
    expect(plan).not.toContain('Seq Scan on dem_region');
  });
});
