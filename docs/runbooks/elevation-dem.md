# Runbook — elevation DEM

**Run this when:** elevation answers come back as "không có dữ liệu" on a machine that should have them, or you are setting up a box from scratch and want the elevation tools to work.

**This is the one dataset that does not arrive with a checkout.** Every other layer in this repo is seeded from a committed GeoJSON. The DEM is a few hundred megabytes, so each machine downloads and loads it once. Until you do, `basemap.dem_region` is empty, `elevation_at_point` answers "không có dữ liệu", and nothing else breaks.

## Licence — read before you publish anything

> **FABDEM is CC BY-NC-SA 4.0: NON-COMMERCIAL, share-alike.**
> This project is a public-sector deliverable, which is the only reason the dataset is usable here. If that ever changes, the source has to change with it — Fathom sells a commercial equivalent (FABDEM+/FathomDEM), and raw Copernicus GLO-30 is the unrestricted fallback (a surface model, so worse, but free of the restriction).

> **Attribution, required wherever these elevations surface:**
> FABDEM is produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018.

> **Citation:** Hawker, L., Uhe, P., Paulo, L., Sosa, J., Savage, J., Sampson, C., & Neal, J. (2022). *A 30 m global map of elevation with forests and buildings removed.* Environmental Research Letters, 17(2), 024016.

The assistant surfaces the source through the provenance chip: `elevation_at_point` sets `datasetVersion` to `FABDEM V1-2`, so the chip under every elevation answer names it. If elevation appears anywhere else in the UI, the notice goes with it — and unlike a courtesy credit, this one is a licence condition.

## What it is, and what it is not

**FABDEM V1-2** — Copernicus GLO-30 with forest and building height biases removed by machine learning. 1 arc-second (~30 m), global 80°N–60°S, from the University of Bristol.

**It is bare earth**, which is the whole reason for choosing it over raw Copernicus. Over Tây Nguyên forest a surface model reads the canopy, not the ground; FABDEM reads the ground. That matters twice over: the cursor readout stops quoting treetop heights, and contours derived from this DEM are cartographic rather than merely de-noised.

**Horizontal WGS84 (EPSG:4326), vertical EGM2008 (EPSG:3855)** — the same vertical datum as Copernicus GLO-30, so values are directly comparable with anything measured before the switch and no datum shift is needed.

**The pixel is not square in metres.** The raster stays in EPSG:4326 to match every other layer, so a pixel is ~30 m north–south but ~29 m east–west at 12°N and shrinks further north. Irrelevant for point lookups; it matters the day someone computes slope or aspect.

**Distribution is different from Copernicus**, which is why step 1 fetches from a mirror rather than from Bristol — see there for the reasoning and the caveat.

## Prerequisites

```bash
pip install rasterio shapely     # rasterio is NOT needed by the other scripts here
docker compose -f infra/docker-compose.yml up -d
```

No system GDAL: `rasterio` bundles its own, the same reasoning as `prep_hydrosheds.py`.

## 1. Download and clip (~5 min)

```bash
python apps/api/scripts/prep_dem.py --dry-run --mainland   # list the tiles, install nothing
python apps/api/scripts/prep_dem.py --mainland             # what you almost certainly want
```

`--dry-run` needs only `shapely`; the rasterio import is lazy, so you can check the tile list before installing anything or downloading a byte.

**Use `--mainland` unless you have a reason not to.** It keeps the contiguous mainland landmass — 18 one-degree tiles — and drops the Hoàng Sa and Trường Sa cells. That is a download-cost decision, not a statement about the region: the archipelagos belong to Đà Nẵng and Khánh Hoà, but nothing the elevation tools are asked about today lives out there. The switch is geometric (largest polygon of the region union), not a longitude cutoff — Trường Sa reaches down to ~7°N while staying *west* of 110°E, so a lon-only rule keeps a lone reef cell.

**It downloads from a mirror, deliberately.** The authoritative Bristol distribution has no per-tile URL: it ships 10×10° ZIPs, 1.7 GB to get the 18 tiles this region needs — measured at 23 KB/s from here, a **20-hour** download. The mirror (Fondazione LINKS, on a public Hugging Face bucket) serves the same tiles individually at **~7.6 MB/s**, rewritten as valid COGs with overview pyramids and **pixel values unchanged**. `prep_dem.py` fetches only the tiles the region needs.

> This is a third-party mirror of a public dataset — the dependency class that already bit this project once (CARTO). `data.bris` stays the canonical fallback: slow, but authoritative. If a number is ever disputed, re-fetch one tile from Bristol and compare.
>
> The mirror labels the licence "Non-Commercial Government Licence v2.0" where Bristol says CC BY-NC-SA 4.0. Both are non-commercial; honour the Bristol terms, which are upstream.

Writes `apps/api/src/db/seeds/data/dem/` (gitignored): `raw/` holds the downloaded tiles, `clipped/` the per-province-polygon clips that get loaded. The clip mask is the union of the six working-region provinces from `apps/web/public/provinces-34.geojson`, padded by ~110 m.

**Clipping is by polygon, not bounding box** — not a detail. The region's bbox runs out to lon ~117.8° because of the archipelagos, so a bbox-driven tile list would fetch a hundred-odd cells of open sea. The same trap the basemap runbook documents.

**The script deletes clips that are not part of the current run.** Without that, clips from a previous source (this pipeline used raw Copernicus GLO-30 before FABDEM) would still be globbed by the loader and silently mixed into the same raster — a surface model and a bare-earth model in one table. If every tile comes back missing, the script now **fails loudly** instead: that means the tile URLs are wrong, not that the region is underwater.

Re-running is cheap — complete tiles are reused, checked by size rather than mere existence. Delete `raw/` once you are happy with the clips.

## 2. Create the table

```bash
npm run migrate:up -w @webatlas/api
```

Migration `1000000000010_dem-raster` creates the `basemap` schema if missing, enables `postgis_raster`, and creates an empty `basemap.dem_region` with the GiST index on `ST_ConvexHull(rast)`.

**The extension is enabled by a migration, not by `infra/postgis/init.sql`.** `init.sql` runs once, when an empty volume is first initialised, so an init-only change would silently skip every database that already exists.

## 3. Load

```bash
apps/api/scripts/load-dem.sh
```

Truncates, loads every clipped tile at 128×128 blocks, then derives the raster constraints. Idempotent: run it twice and you still have one copy.

## 4. Verify

The script finishes by printing the tile count, on-disk size, the loaded extent, and four sample points. A good load on the mainland-only tile set looks like:

| Point | Expected |
|---|---|
| Buôn Ma Thuột (108.0447, 12.6797) | ~472 m |
| Chu Yang Sin (108.4244, 12.4061) | ~2,415 m |
| Đà Nẵng shore (108.2440, 16.0600) | ~7 m |
| Offshore (112, 12) | `NULL` |

Measured on the FABDEM load: **7,242 raster tiles, 406 MB**, extent 107.20–109.46 E / 10.57–16.22 N.

**Read the summit row carefully.** Chu Yang Sin is published at 2,442 m and the DEM says 2,415 m — correct, not a fault. A 30 m grid averages a sharp peak away, and bare earth strips whatever grows on it. The coordinates above are the DEM's own high pixel; a *published* summit coordinate even 2 km out lands on the flank and reads hundreds of metres low, which looks like broken data and is not. Buôn Ma Thuột is the robust check — a broad plateau, insensitive to being a few hundred metres off.

**Values are lower than the old Copernicus load, by design.** Measured against the Copernicus tiles over the same ground: mean −4.1 m in Lâm Đồng highland forest, **−8.5 m (median −8.4)** in Quảng Nam mountain forest, p95 −18 m, max −88 m. That removed canopy is the entire point of the switch — at a 20 m contour interval, an 8 m bias is nearly half a contour.

All four `NULL` means the mask or the tile list missed the mainland; do not proceed, the elevation tools will be confidently empty.

Then ask the assistant: *"Buôn Ma Thuột cao bao nhiêu mét so với mực nước biển?"* — expect a number around 500 m and two provenance chips (`locate_place`, `elevation_at_point`).

## Gotchas

- **`raster2pgsql` is not in the `postgis/postgis:16-3.4` image.** The server-side extension is there, the client binary is not (`find / -name 'raster2pgsql*'` comes back empty). Every raster tutorial's one-liner fails on this stack. `load-dem.sh` works around it with a one-off image built from `apps/api/scripts/raster-tools.Dockerfile` — deliberately *not* by rebuilding the `db` service, which would make every developer build an image to gain a binary used once.
- **The loader talks to `db` over the compose network**, not `localhost`. If the network is not `webatlas_default` on your machine, set `DEM_NETWORK`.
- **`AddRasterConstraints('basemap','dem_region','rast')` fails with "The table 'basemap' does not occur in the search_path".** Three bare string literals resolve to the `(table, column, VARIADIC constraints[])` overload instead of `(schema, table, column)`, so PostGIS reads `basemap` as the table name. Cast them: `'basemap'::name,'dem_region'::name,'rast'::name`. The script does; the error message points nowhere near the cause.
- **`raster2pgsql -F` needs a `filename` column**, which is why the migration creates one. Without it the very first tile dies with `column "filename" of relation "dem_region" does not exist`.
- **Constraints are dropped before each load and re-added after.** `AddRasterConstraints` pins the extent from the rows present when it runs, so a second load into a constrained table would be rejected by the constraint the first load added.
- **The clip mask uses the simplified browser boundaries** (~11 m Douglas-Peucker). Fine for deciding which 30 m pixels to keep, padded well beyond the error. Do **not** reuse that reasoning for anything that measures against a boundary.

## Cost

Measured for the mainland-only set: 512 MB of raw downloads (deletable), 285 MB of clipped GeoTIFFs, and **406 MB in the database** across 7,242 raster rows (matching the live load counted in §4 above — the 426 MB / 7,301-row figure once here was a stale Copernicus-load number). `pg_total_relation_size` is printed at the end of the load.

## What is not built yet

Only `elevation_at_point` exists. `elevation_of_feature` (min/max/mean over a polygon via `ST_SummaryStats`) and `elevation_profile` (drop and mean gradient along a river reach) are designed in [the spatial tools handover, §6.4.1](../superpowers/specs/2026-09-14-spatial-analysis-tools-handover.md) but unwritten.

Watersheds, flow accumulation and stream delineation are **not** possible from this dataset: they need flow-direction and accumulation rasters, not a bare DEM.

`elevation_at_point` is registered unconditionally, so on a box without the DEM its definition costs cached-prefix tokens on every assistant turn to answer "không có dữ liệu". Accepted for one tool; when the other two land, gate all three behind one capability probe.
