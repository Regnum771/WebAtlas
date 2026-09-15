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
| 6 | [Elevation DEM](elevation-dem.md) | Optional — elevation tools only | **No** — generated locally |
| 7 | [Terrain contours](terrain-contours.md) | Optional — needs step 6 first | **No** — generated locally |
| 8 | `npm run publish:geoserver -w @webatlas/api` | Required | Yes (script; publishes to GeoServer, not git) |

## Notes on each step

1. **Bring up the stack.** Starts Postgres/PostGIS and GeoServer. No runbook of its own —
   the compose file is [`infra/docker-compose.yml`](../../infra/docker-compose.yml).
2. **Create the schema.** Runs every migration under
   [`apps/api/src/db/migrations`](../../apps/api/src/db/migrations), including the ones
   that create `basemap.dem_region` and `basemap.contours` empty and ready for steps 6–7.
3. **Load the committed feature layers** (dams, rivers, lakes, stations, flood zones,
   drought points, saltwater intrusion) from the GeoJSON under
   [`apps/api/src/db/seeds/data`](../../apps/api/src/db/seeds/data) — these files are in
   git, so this step is fully reproducible from a checkout.
4. **Load the river network** into the `rivers` table — also seed data checked into git,
   run separately from step 3 because it has its own ingest path
   ([`ingestRivers.ts`](../../apps/api/src/db/seeds/ingestRivers.ts)).
5. **Rebuild the street basemap** from an OpenStreetMap extract. Not in git — CARTO and
   Esri tiles cannot be re-hosted under their terms, so this is the one basemap tier the
   project builds itself. Skipping this step leaves the street tier broken (a grey
   "API KEY REQUIRED" tile at HTTP 200, or nothing at all before the rebuild).
6. **Load a bare-earth DEM** (FABDEM). Optional: nothing else in the app breaks without
   it, but `elevation_at_point` answers "không có dữ liệu" and the terrain-contours step
   has nothing to contour.
7. **Generate and publish contour lines** from that DEM. Optional in the same sense as
   step 6, and only meaningful once step 6 has run.
8. **Publish the feature layers to GeoServer** — creates the `webatlas_water` datastore
   and the WMS/WFS layers the web app actually renders. Run this last: it publishes
   whatever is already in the database, so anything loaded after it (a re-run of step 3,
   for instance) needs it run again.

## Why steps 5–7 are "not in git"

Each is a real dataset (hundreds of megabytes to ~1 GB combined) rebuilt from an external
source rather than committed: OpenStreetMap for the basemap, FABDEM for the DEM, and the
DEM again (derived) for contours. Every other layer in this repo ships as a committed
GeoJSON seed. Committing these three would blow up repository size for data that is
either downloadable on demand or, for contours, cheaply regenerable from what was already
downloaded. The cost is that every machine pays the generation time once — the DEM runbook
and the contours runbook both record the measured time and output so a future run can be
compared against a known-good one.
