/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Elevation raster: the table and the extension, not the data.
 *
 * The DEM is a ~30 m FABDEM V1-2 mosaic (bare earth: Copernicus GLO-30 with forest and
 * building height removed) clipped to the six working-region provinces. It is far too
 * large to commit, so unlike every other layer in this repo the data does NOT arrive
 * with a checkout — a developer runs
 * `scripts/prep_dem.py --mainland` then `scripts/load-dem.sh` once. See
 * docs/runbooks/elevation-dem.md. Until then this table is simply empty, and the
 * elevation tools report "no data" rather than failing.
 *
 * Why the extension lives in a migration rather than infra/postgis/init.sql:
 * init.sql runs ONCE, on first initialisation of an empty volume. Adding
 * postgis_raster there only would silently skip every database that already
 * exists — i.e. every developer's box and any deployed instance. Migrations run
 * everywhere, which is the whole point of them.
 *
 * Why `basemap` and not `water`: this is reference data with no editing, no
 * stewardship and no dataset_versions chain, exactly like basemap.places_region.
 * Putting it in `water` would imply a versioned thematic layer it is not. The
 * schema is created here with IF NOT EXISTS because a box that has never run
 * the basemap loader has no `basemap` schema at all.
 *
 * Deliberately no raster constraints here (srid, scale, blocksize, extent...).
 * AddRasterConstraints() reads the loaded tiles to derive them, so it can only
 * run after the data is in; the loader applies it as its last step. An empty
 * table with constraints would also reject the very first tile.
 *
 * This table crosses INV-5 (docs/superpowers/specs/2026-07-10-webgis-water-resources-
 * backend-design.md §"Invariants"): "Raster EO data lives as COGs + GeoServer coverages,
 * never in PostGIS." basemap.dem_region is exactly that — raw raster pixels in PostGIS —
 * and this migration departs from INV-5 knowingly. The reason: both consumers of this
 * DEM need the pixels reachable from server-side SQL, which a GeoServer coverage store
 * does not offer. `elevation_at_point` is `ST_Value(rast, ST_Point(...))` against a
 * single row; a coverage store only serves rendered tiles or WCS clips over HTTP, with
 * no per-point SQL lookup. `ST_Contour` (migration 1000000000011) needs the same pixels
 * as SQL input to produce vector lines — there is no way to hand a coverage store's
 * imagery to a SQL contouring function without loading it into PostGIS first anyway.
 * INV-5's EO pipeline (§14) is solving a different problem (serving big, frequently
 * updated satellite mosaics as map tiles) and that reasoning does not transfer to a
 * single, mostly-static bare-earth DEM queried point-by-point and contoured in SQL.
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS basemap');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS postgis_raster');

  // `filename` is not decoration: raster2pgsql -F populates it with the source tile,
  // which is the only way to trace a suspicious pixel back to the 1-degree cell it came
  // from once 19 tiles have been diced into thousands of 128x128 rows. The column name
  // is fixed by raster2pgsql, not chosen here — without it the loader fails outright.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS basemap.dem_region (
      rid      serial PRIMARY KEY,
      rast     raster NOT NULL,
      filename text
    )
  `);

  // The spatial index for a raster table goes on ST_ConvexHull(rast) — rasters
  // have no geometry column of their own, and every ST_Value/ST_Clip lookup is
  // an intersection against that hull.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS dem_region_rast_convexhull_idx
      ON basemap.dem_region USING GIST (ST_ConvexHull(rast))
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS basemap.dem_region');
  // postgis_raster is left installed, for the same reason migration
  // 1000000000007 leaves pg_trgm: dropping an extension takes every dependent
  // object with it, and this one is cheap to leave in place. The schema is left
  // alone too — the basemap loader's tables live in it.
};
