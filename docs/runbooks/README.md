# Runbooks — setup order

**Read this before any individual runbook.** As of the DEM load, a fresh clone no longer
produces a working app by itself: roughly 1 GB of data lives outside git, behind runbooks
that must run in a particular order, and until now nothing wrote that order down.

This is that order, start to finish. Each step names whether it is required for a normal
dev box or optional (unlocks one feature, safe to skip and do later).

| # | Step | Required? | In git? |
|---|---|---|---|
| 1 | `docker compose -f infra/docker-compose.yml up -d` | Required | — (infra, not data) |
| 2 | `npm run migrate:up -w @webatlas/api` | Required | Yes (migrations) |
| 3 | `npm run seed -w @webatlas/api` | Required | Yes (seed GeoJSON) |
| 4 | `npm run ingest:rivers -w @webatlas/api` | Required | Yes (seed GeoJSON) |
| 5 | [Self-hosted basemap](self-hosted-basemap.md) | Required | **No** — rebuilt from an OSM extract |
| 6 | `npm run reference:build -w @webatlas/api` | Required — needs step 5 first | Yes (script; rebuilds a derived table, not data) |
| 7 | [Elevation DEM](elevation-dem.md) | Optional — elevation tools only | **No** — generated locally |
| 8 | [Terrain contours](terrain-contours.md) | Optional — needs step 7 first | **No** — generated locally |
| 9 | `npm run publish:geoserver -w @webatlas/api` | Required | Yes (script; publishes to GeoServer, not git) |

## Notes on each step

1. **Bring up the stack.** Starts Postgres/PostGIS and GeoServer. No runbook of its own —
   the compose file is [`infra/docker-compose.yml`](../../infra/docker-compose.yml).
2. **Create the schema.** Runs every migration under
   [`apps/api/src/db/migrations`](../../apps/api/src/db/migrations), including the ones
   that create `basemap.dem_region` and `basemap.contours` empty and ready for steps 7–8.
3. **Load the committed feature layers** (dams, rivers, lakes, stations, flood zones,
   drought points, saltwater intrusion) from the GeoJSON under
   [`apps/api/src/db/seeds/data`](../../apps/api/src/db/seeds/data) — these files are in
   git, so this step is fully reproducible from a checkout.

   `npm run seed` now also loads `admin.provinces` / `admin.wards` from the GeoJSON committed in `apps/web/public`, and
   stamps `province_codes` / `ward_codes` onto every feature. No network access is required.

   **Upgrading an existing database:** migration `1000000000016_admin-stamping` adds `province_codes` /
   `ward_codes` with `DEFAULT '{}'` and does not backfill them — a database that already had data before that
   migration reads every feature as belonging to no administrative unit until it is re-seeded. Run `npm run seed
   -w @webatlas/api` and `npm run ingest:rivers -w @webatlas/api` again after migrating; otherwise
   `GET /api/layers/<layer>/features?province=…` and the assistant's `features_in_admin_unit` tool return `200`
   with an empty result, silently, rather than an error that would flag the staleness.
4. **Load the river network** into the `rivers` table — also seed data checked into git,
   run separately from step 3 because it has its own ingest path
   ([`ingestRivers.ts`](../../apps/api/src/db/seeds/ingestRivers.ts)).
5. **Rebuild the street basemap** from an OpenStreetMap extract. Not in git — CARTO and
   Esri tiles cannot be re-hosted under their terms, so this is the one basemap tier the
   project builds itself. Skipping this step leaves the street tier broken (a grey
   "API KEY REQUIRED" tile at HTTP 200, or nothing at all before the rebuild).
6. **Rebuild the dissolved reference entities.** `load_basemap.py` (step 5) loads every
   `basemap` table with GeoPandas `to_postgis(..., if_exists="replace")`, which drops and
   recreates each table — so `basemap.reference_entities` (the searchable, named roads,
   railways, water bodies, land use and places built from those raw tables) is stale
   from the moment step 5 finishes, referring to rows that no longer exist and missing
   ones that now do. This step rebuilds it from the tables step 5 just loaded:

       npm run reference:build -w @webatlas/api

   Required for a normal dev box because `GET /api/reference/*` and the `ref:*` sources
   on `GET /api/search` (roads, railways, water, landuse, places) read only this table,
   never the raw ones — skip it and those return stale or empty results with no error.
   See `docs/architecture/database-architecture.md` §10.2 for why the derived table,
   not the raw ones, carries the search index in the first place.
7. **Load a bare-earth DEM** (FABDEM). Optional: nothing else in the app breaks without
   it, but `elevation_at_point` answers "không có dữ liệu" and the terrain-contours step
   has nothing to contour.
8. **Generate and publish contour lines** from that DEM. Optional in the same sense as
   step 7, and only meaningful once step 7 has run.
9. **Publish the feature layers to GeoServer** — creates the `webatlas_water` datastore
   and the WMS/WFS layers the web app actually renders. Run this last: it publishes
   whatever is already in the database, so anything loaded after it (a re-run of step 3,
   for instance) needs it run again.

## Why steps 5, 7 and 8 are "not in git"

(Step 6, the reference-entity rebuild, is a checked-in script and is excluded here for
the same reason step 3's ingest is: it is fully reproducible from whatever the previous
step just loaded, not a dataset of its own.)

Each is a real dataset (hundreds of megabytes to ~1 GB combined) rebuilt from an external
source rather than committed: OpenStreetMap for the basemap, FABDEM for the DEM, and the
DEM again (derived) for contours. Every other layer in this repo ships as a committed
GeoJSON seed. Committing these three would blow up repository size for data that is
either downloadable on demand or, for contours, cheaply regenerable from what was already
downloaded. The cost is that every machine pays the generation time once — the DEM runbook
and the contours runbook both record the measured time and output so a future run can be
compared against a known-good one.
