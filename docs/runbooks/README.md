# Runbooks — how the atlas is built

**Run `npm run atlas:up`.** It performs every step that used to be listed here, in the right
order, and is safe to re-run: finished work is skipped, an interrupted run resumes. A fresh clone
no longer needs a Python geo stack, GDAL, `raster2pgsql` or any manual download — those tools run
inside the `atlas-tools` image (Debian bookworm, Python 3.11, `postgresql-client-16`, PostGIS
`raster2pgsql` 3.6.x, about 764 MB), which `atlas:up` builds. About 1 GB of the data lives outside git
(the OpenStreetMap extract and FABDEM tiles); `atlas:up` fetches it.

```bash
npm install
npm run atlas:up
```

The old numbered steps map onto the registry as follows. Each dataset is a row in the registry
(`packages/atlas-data/src/descriptors`); the last column is the manual rerun.

| Old step | Now | Manual rerun | In git? |
|---|---|---|---|
| 1 stack | `atlas:up` (`up -d --no-recreate db geoserver`, then waits for readiness) | `npm run atlas:up` | — (infra, not data) |
| 2 migrate | `atlas:up` | `npm run migrate` | Yes (migrations) |
| 3 seeds | dataset `admin_boundaries`, then one dataset per layer (`dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`, `lakes`) | `npm run atlas:build -- --only <layer>` | Yes (seed GeoJSON) |
| 4 rivers | dataset `rivers` (depends on `admin_boundaries`) | `npm run atlas:build -- --only rivers` | Yes (seed GeoJSON) |
| 5 [Self-hosted basemap](self-hosted-basemap.md) | dataset `basemap` | `npm run atlas:build -- --only basemap` | **No** — rebuilt from an OSM extract |
| 6 reference entities | dataset `reference_entities` (depends on `basemap`) | `npm run atlas:build -- --only reference_entities` | Yes (script; rebuilds a derived table) |
| 7 [Elevation DEM](elevation-dem.md) | dataset `dem` (optional: `--except dem`) | `npm run atlas:build -- --only dem` | **No** — generated locally |
| 8 [Terrain contours](terrain-contours.md) | dataset `contours` (depends on `dem`) | `npm run atlas:build -- --only contours` | **No** — generated locally |
| 9 publish to GeoServer | stages of each dataset (`seeds`, `rivers`, `basemap` and `contours` all publish their layers inside their own stages) | rerun the dataset | Yes (script; publishes to GeoServer, not git) |

`demo` is a synthetic dataset with no runbook. Day to day: `npm run atlas:status` says what is built, stale,
missing or failed and the one command to run next; `npm run atlas:verify` checks the atlas actually serves;
`npm run atlas:adopt` records a machine set up before the registry without re-running anything. Use
`npm run atlas:build -- --force <id>` to rebuild on purpose (forcing a dataset invalidates its dependents, which rebuild only if they are in the selection: `--force basemap` alone also rebuilds `reference_entities`, while `--only basemap --force basemap` leaves it `missing` until a full build).
`atlas:up` accepts `--compose <file>` and the build flags `--only`, `--except`, `--force` and `--supersede-edits`.

The old `npm run seed`, `ingest:rivers` and `publish:geoserver` commands are gone: the registry loads and publishes
those layers itself. `reference:build` and `contours:generate` remain as the commands two `run` stages call, and
`npm run atlas:seed` loads the seed data alone, for CI and test databases. Scripts read the GeoServer password from the environment (`infra/.env`, through the compose
service), never from argv.

To run one script by hand, for example to debug it, use the tools image:

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools <argv>
```

For map users: [Vùng phân tích](vung-phan-tich.md) explains choosing an ROI and the analysis tools.

## Notes on each step

Reference material about what each dataset does. `atlas:up` runs all of it; the `npm run atlas:build -- --only <id>`
lines are for a manual rerun.

1. **The stack.** `atlas:up` starts Postgres/PostGIS and GeoServer without ever recreating or stopping a running
   service, then waits for `pg_isready` and the GeoServer REST API. No runbook of its own —
   the compose file is [`infra/docker-compose.yml`](../../infra/docker-compose.yml).
2. **The schema.** `atlas:up` runs every migration under
   [`apps/api/src/db/migrations`](../../apps/api/src/db/migrations), including the ones
   that create `basemap.dem_region` and `basemap.contours` empty and ready for steps 7–8.
3. **`admin_boundaries` and the seven layer datasets** (`dams`, `lakes`, `stations`, `flood_zones`, `flood_generation`,
   `drought_points`, `saltwater_intrusion`). `admin_boundaries` loads `admin.provinces` / `admin.wards` from the
   GeoJSON committed in `apps/web/public`; each layer dataset then loads its GeoJSON from
   [`packages/atlas-data/data/seeds`](../../packages/atlas-data/data/seeds), stamps `province_codes` / `ward_codes`
   onto every feature, and publishes the layer. The files are in git, so this is fully reproducible from a checkout
   with no network access. Manual rerun of one: `npm run atlas:build -- --only dams`.

   A load is keyed to the file's content: rebuilding with an unchanged file creates no new version and only
   re-stamps the administrative codes. Changing the boundary files re-stamps every layer. If a layer has steward
   edits on top of its last load, loading *changed* content stops with a message instead of hiding them; pass
   `--supersede-edits <layer>` to go ahead.

   **Upgrading an existing database:** migration `1000000000016_admin-stamping` adds `province_codes` /
   `ward_codes` with `DEFAULT '{}'` and does not backfill them — a database that already had data before that
   migration reads every feature as belonging to no administrative unit until it is re-stamped. Run
   `npm run atlas:build -- --force admin_boundaries` after migrating, which re-stamps every layer; otherwise
   `GET /api/layers/<layer>/features?province=…` and the assistant's `features_in_admin_unit` tool return `200`
   with an empty result, silently, rather than an error that would flag the staleness.

   **Upgrading past migration `1000000000020_rivers-level-views`:** it replaces the far-zoom
   `rivers_overview` materialised view with a plain view and adds `rivers_detail`. Re-run step 4
   (a `rivers` version ingested before migration 19 has no reaches or rivers at all) and then
   step 9: the publish stage repoints `webatlas:rivers` at `rivers_detail` and resets
   GeoServer's cached attribute schema (`npm run atlas:build -- --force rivers` does both). Skip step 9 and the detailed map draws every river as
   its ways, reaches and river entity stacked on top of each other.
4. **The `rivers` dataset** loads the river network into the `rivers` table — also seed data checked into git.
   It loads two files (`osm-rivers-region.geojson`, `hydrorivers-region.geojson`) into one version, and activation
   builds the river hierarchy and runs its gates. One version holds
   all three levels: 9,486 OSM ways, 13,045 HydroRIVERS reaches, and the 588 named rivers
   built from them.

   Activating that version also **builds the river hierarchy and runs its activation gates**
   (see `docs/architecture/database-architecture.md` §9), so this step takes about a minute
   and prints nothing about the hierarchy itself. Check the result with the read-only
   `npm run rivers:hierarchy -w @webatlas/api`, which should report `588 rivers from 439
   names over 4716 named reaches (38 bridged)` and `0 rows would change`. If a gate fails,
   the ingest throws and **the version is not activated** — the previous `rivers` version
   is still the live one, so the map keeps working; read the gate message, don't retry
   blindly. Manual rerun: `npm run atlas:build -- --only rivers`.

   **Runs after `seeds`** (`dependsOn`, no longer prose). Activation stamps administrative codes onto the new rows
   (including the 588 rivers it just built), and the boundaries it stamps against are
   loaded by `seed`. Run in the other order and every river reads as belonging to no
   province or ward.
5. **The `basemap` dataset** rebuilds the street basemap from an OpenStreetMap extract, in five stages: fetch the
   Geofabrik extract, `load_basemap.py`, `publish-basemap.sh featuretypes`, `styles.py`, `publish-basemap.sh group`. Not in git — CARTO and
   Esri tiles cannot be re-hosted under their terms, so this is the one basemap tier the
   project builds itself. Skipping this step leaves the street tier broken (a grey
   "API KEY REQUIRED" tile at HTTP 200, or nothing at all before the rebuild). Manual rerun:
   `npm run atlas:build -- --force basemap`.
6. **The `reference_entities` dataset** rebuilds the dissolved reference entities. `load_basemap.py` (step 5) loads every
   `basemap` table with GeoPandas `to_postgis(..., if_exists="replace")`, which drops and
   recreates each table — so `basemap.reference_entities` (the searchable, named roads,
   railways, water bodies, land use and places built from those raw tables) is stale
   from the moment step 5 finishes, referring to rows that no longer exist and missing
   ones that now do. This dataset rebuilds it from the tables step 5 just loaded, and depends on `basemap`, so a
   forced basemap rebuild rebuilds it too. Manual rerun: `npm run atlas:build -- --only reference_entities`
   (the underlying script is `npm run reference:build -w @webatlas/api`).

   Required for a normal dev box because `GET /api/reference/*` and the `ref:*` sources
   on `GET /api/search` (roads, railways, water, landuse, places) read only this table,
   never the raw ones — skip it and those return stale or empty results with no error.
   See `docs/architecture/database-architecture.md` §10.2 for why the derived table,
   not the raw ones, carries the search index in the first place.
7. **The `dem` dataset** loads a bare-earth DEM (FABDEM). Optional (`atlas:up -- --except dem`): nothing else in the app breaks without
   it, but `elevation_at_point` answers "không có dữ liệu" and the terrain-contours step
   has nothing to contour. Manual rerun: `npm run atlas:build -- --only dem`.
8. **The `contours` dataset** generates and publishes contour lines from that DEM. Optional in the same sense as
   step 7, and it depends on `dem`, so excluding `dem` excludes it too. Manual rerun:
   `npm run atlas:build -- --only contours`.
9. **Publishing the feature layers to GeoServer** — creates the `webatlas_water` datastore
   and the WMS/WFS layers the web app actually renders. Publishing is part of each dataset's own stages: the seven layer datasets (one `publish-geoserver` stage each),
   `rivers`, `basemap` and `contours` all publish their layers, so there is no separate publish step and publishing
   follows its data automatically.

## Why `basemap`, `dem` and `contours` are "not in git"

(`reference_entities`, the reference-entity rebuild, is a checked-in script and is excluded here for
the same reason the `rivers` ingest is: it is fully reproducible from whatever the previous
step just loaded, not a dataset of its own.)

Each is a real dataset (hundreds of megabytes to ~1 GB combined) rebuilt from an external
source rather than committed: OpenStreetMap for the basemap, FABDEM for the DEM, and the
DEM again (derived) for contours. Every other layer in this repo ships as a committed
GeoJSON seed. Committing these three would blow up repository size for data that is
either downloadable on demand or, for contours, cheaply regenerable from what was already
downloaded. The cost is that every machine pays the generation time once (`atlas:up` does it for you) — the DEM runbook
and the contours runbook both record the measured time and output so a future run can be
compared against a known-good one.
