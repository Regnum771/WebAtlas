import type { Pool } from 'pg';

/**
 * The one place that reads basemap.dem_region.
 *
 * Two consumers now: the assistant's `elevation_at_point` tool and GET /api/elevation
 * behind the cursor readout. They need different presentation (Vietnamese prose plus a
 * provenance record vs. JSON) but exactly the same query, and the tri-state below is
 * what lets them differ without either re-deriving the SQL.
 */

/**
 * What the provenance chip and the API response credit as the source. Not a
 * dataset_versions label — the DEM is unversioned reference data — but the licence
 * REQUIRES the source wherever these numbers surface, and FABDEM is CC BY-NC-SA, so
 * the obligation is stricter than a courtesy. See FABDEM_ATTRIBUTION in
 * packages/shared/src/legend.ts (also quoted in docs/runbooks/elevation-dem.md) for the
 * required attribution text.
 *
 * FABDEM is bare earth: Copernicus GLO-30 with forest and building height removed. The
 * distinction matters to callers — a value here is ground level, not canopy top.
 */
export const DEM_SOURCE = 'FABDEM V1-2';

/** Postgres "undefined_table". */
const UNDEFINED_TABLE = '42P01';

/**
 * Three outcomes, not two, because the callers genuinely need to tell them apart:
 *
 *  - `ok`          a real elevation.
 *  - `nodata`      the DEM is loaded but says nothing here: a nodata pixel (outside the
 *                  clipped six provinces) or no tile at all. A legitimate answer.
 *  - `unavailable` this deployment has never loaded the DEM. Not an error and not a
 *                  gap in the data — a box that has not run the runbook yet.
 *
 * Collapsing the last two into `null` would make the UI unable to stay quiet about an
 * unloaded DEM while still reporting honest gaps, and would let a missing table read as
 * "this place has no elevation".
 */
export type ElevationResult =
  | { status: 'ok'; elevationM: number }
  | { status: 'nodata' }
  | { status: 'unavailable' };

export async function elevationAt(pool: Pool, lon: number, lat: number): Promise<ElevationResult> {
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
  let rows: Array<{ elevationM: number | null }>;
  try {
    // ST_Intersects(raster, geometry) is served by the GiST index on ST_ConvexHull(rast)
    // that migration 1000000000010 creates, so this touches one 128x128 tile out of
    // ~7,300 rather than scanning the mosaic. ST_Value returns NULL on a nodata pixel,
    // which the clip leaves everywhere outside the six provinces — so "off the edge of
    // coverage" arrives as a NULL value rather than as no row. Both mean `nodata`.
    ({ rows } = await pool.query<{ elevationM: number | null }>(
      `SELECT round(ST_Value(rast, ${point})::numeric, 1)::float8 AS "elevationM"
         FROM basemap.dem_region
        WHERE ST_Intersects(rast, ${point})
        LIMIT 1`,
      [lon, lat]
    ));
  } catch (e) {
    if ((e as { code?: string }).code === UNDEFINED_TABLE) return { status: 'unavailable' };
    throw e;
  }

  const elevationM = rows[0]?.elevationM ?? null;
  return elevationM === null ? { status: 'nodata' } : { status: 'ok', elevationM };
}
