# Measure-first optimisation (after S1)

**Status:** approved in brainstorming, 2026-10-05.
**Track:** the optimisation group between S1 (active data, shipped) and the restructure groups R1–R4.

## Why: what users wait for, measured

Dev stack, 2026-10-05, after S1. Map times are from headless Chrome against the production build; everything else from timed HTTP requests. Each number is a median of repeated runs unless marked "cold".

| What a user does | Measured | Verdict |
|---|---|---|
| Open the app (shell, scripts) | page ready 0.25 s; map quiet 1.3 s later on a warm tile cache | fine |
| Same on a cold tile cache | single basemap/roads tiles up to **4 s**; map quiet after ~4.6 s | slow while the cache is cold |
| Far-zoom river layer `rivers_overview` (WFS) | **0.8–1.0 s per request**, 5.5 s cold | slow: the view filters on `ST_SimplifyPreserveTopology(geom)`, so every request simplifies all 579 level-1 rivers first |
| Zoom 7 → 11 into the water layers | **2–6 s** to settle; rivers WFS **2.4 s**, lakes 1 s; main-thread tasks up to **315 ms** while parsing | the slowest thing a user does |
| Pan at working zoom (≥ 10) | WFS 0.01–0.15 s per layer | fine |
| Search, lookups, feature lists | 1–35 ms | fine |
| Analysis (select, nearest, elevation) | 0.1–0.4 s | fine |
| Anything from "longest river + 10 km" | **~1 s** (`roi/resolve` 0.94 s, select-within 0.98 s) | slow-ish |
| Developer: test suites | versioning ~110 s (two river files 93 s); API ~100 s (tests 46 s, the rest start-up) | slow |
| Basemap rebuild | a tile-cache miss on the table being reloaded waits up to ~4 min | only during a rebuild |

Ruled out by the numbers: GeoServer already gzips WFS responses (about 7×); cached tiles answer in 5–20 ms; the assistant's latency is dominated by model calls, and its database work is the analysis numbers above.

Found and deliberately left for later: saving an edit to a river takes ~10–15 s, because every `rivers` activation rebuilds the hierarchy (~10 s) and runs its gates (~5 s). Making that incremental touches the river topology builder and its pin; it is the next candidate after this group.

Methodology note, so the "after" numbers are comparable: on this Windows machine `localhost` resolves to IPv6 first and the API listens on IPv4, so non-browser clients must use `127.0.0.1` (a plain `localhost` request adds a 2 s fallback that browsers do not have).

## Decisions (user, 2026-10-05)

| | Decision |
|---|---|
| D1 | Fix all four groups: water layers, far-zoom rivers + cold tiles, river + 10 km, developer speed (O4, O5). |
| D2 | Rivers, lakes and the far-zoom river layer become vector tiles served by the API (PostGIS `ST_AsMVT`), not GeoServer vector tiles and not tiled WFS. |
| D3 | The tile cache is seeded after each basemap/contours build, in the background; the build does not wait. |
| D4 | River edit save time is out of scope here; next candidate. |
| D5 | Code comments in English (standing rule). |

## Design

### 1. Water layers as vector tiles from the API

**Endpoint.** `GET /api/tiles/:layer/:z/:x/:y.pbf`, `:layer` ∈ {`rivers`, `lakes`, `rivers_overview`}; anything else is 404. One query per tile: `ST_AsMVT` over `ST_AsMVTGeom(ST_Transform(geom, 3857), <tile envelope>, 4096, 64)` from the layer's active view, with `geom && ST_Transform(<tile envelope>, 4326)` so the S1 partial spatial index serves it. Each feature carries exactly the properties the popup, the styles and the ROI candidates read today, plus `id` and `layerKey`.
- `rivers`: the rows `water.rivers_detail` serves (level 3), the layer drawn at zoom ≥ 8.5.
- `rivers_overview`: the rows `water.rivers_overview` selects (level-1 rivers with at least one OSM `waterway=river` way), drawn below 8.5, with the geometry left to `ST_AsMVTGeom`'s tile-resolution simplification instead of a fixed `ST_SimplifyPreserveTopology(geom, 0.01)` over the whole layer.
- `lakes`: `water.lakes_active`.

The tile envelope comes from `z/x/y` (Web Mercator); `z` above 16 or out-of-range `x`/`y` is 400. Empty tiles return 204 with no body.

**Caching.** Tile URLs carry the layer's active version: `?v=<versionId>`. `GET /api/tiles/versions` returns `{ rivers, lakes }` → active version ids (`rivers_overview` uses `rivers`'). Tile responses with a `v` that matches the active version are `Cache-Control: public, max-age=31536000, immutable`; a request with a stale or missing `v` is served fresh with `Cache-Control: no-cache`. An activation changes the id, so the next URL is new and nothing stale is drawn. No server-side tile cache in this group.

**Web app.**
- `layer_rivers`, `layer_rivers_overview` and `layer_lakes` become OpenLayers `VectorTileLayer`s (MVT format) with the same style functions and the same zoom ranges. The source-removal zoom gate for rivers and lakes goes: tiles only load what is visible. The far-zoom/near-zoom handoff (`RIVER_OVERVIEW_MAX_ZOOM`) stays.
- Popups and ROI candidates keep using `forEachFeatureAtPixel`; tile features carry the same properties (the WFS id fallback `<typename>.<uuid>` becomes the `id` property).
- Editing: selecting a river or lake (the `SelectController`) fetches the full geometry with the existing `GET /api/features/:layerKey/:id/geometry` before handing the selection to the editor; a tile geometry is clipped and simplified and must never be edited.
- After an edit commits, the app re-reads `/api/tiles/versions` and swaps the tile URLs of the changed layer.
- `dams` and the five small thematic layers stay on WFS (1–80 kB, already fast).

### 2. No cold tiles after a build

The basemap and contour builds keep truncating their tile cache (stale tiles are worse than slow ones). Right after the truncate, a new final `run` stage of the `basemap` and `contours` datasets starts a GeoServer tile-cache seed and returns at once:
- the five basemap layer groups (`basemap`, `basemap_roads`, `bm_water`, `bm_landuse`, `bm_railways`), zooms 5–12;
- the contour layers at the zooms the web app shows them (taken from `MapModel`'s contour switching during planning);
- extent: the six working provinces (about 106.5–110.0 E, 10.5–16.6 N), about 4,000 tiles per layer group;
- GeoServer seeds in the background (`/gwc/rest/seed/<layer>.json`, `type=seed`, `gridSetId=EPSG:900913`, two threads). A tile requested before the seed reaches it renders on demand as today. Zoom 13 and above stay on demand.

The step lives as a `seed` subcommand of `packages/atlas-data/tools/basemap/publish-basemap.sh` and `tools/contours/publish-contours.sh` (same `gs_curl`/`require_2xx` helpers, password from the environment, never argv).

### 3. River + 10 km

In `apps/api/src/modules/roi/resolve.ts`:
1. The source line is simplified before buffering, with a tolerance of 1 % of the radius (100 m at 10 km), converted to degrees at the source's latitude. The source-complexity guards stay as they are and apply to the original source.
2. The working region becomes a one-row materialised view `admin.working_region` (the union of the six provinces), created by a migration and refreshed by the `admin_boundaries` load right after it replaces the tables; `REGION_SQL` reads it.
3. The remaining ~0.5 s (source fetch, area, display outline, centroid) is profiled step by step during implementation and the largest part fixed; the plan records what was found.

Results stay the same apart from boundary differences within the tolerance; the existing ROI and analysis tests pass unchanged.

### 4. Developer speed

- **River test files** (`packages/versioning/src/riverHierarchy.test.ts`, `riverHierarchy-hook.test.ts`): build the hierarchy once per file and share it across that file's tests instead of once per test; tests that need their own activation keep it.
- **API suite start-up:** profile the ~50 s outside the tests (global setup, module collection, per-file start-up with `fileParallelism: false`) and remove what need not happen on every run.
- **Basemap rebuild (O5):** `load_basemap.py` writes each table into `basemap.<table>__new` and, in one short transaction, drops the old table and renames the new one (indexes renamed with it); a failed load leaves the old table untouched, as now.

## Success criteria (re-measured with the same scripts)

The three measurement scripts used here (WFS/tiles/API timings in Python, the Chrome page script) are committed under `tools/perf/` with a README, so the after-measurement is the same method.

- Zoom 7 → 11 into the water layers settles in under 1 s on a warm browser cache and under 2 s cold; no main-thread task over 100 ms.
- Far-zoom river layer: under 0.1 s per tile.
- After `atlas:build -- --force basemap` and the seed's completion, the 4×4 tile sample at zooms 9, 11, 12 is all cache hits at 5–20 ms; Chrome first load on a freshly rebuilt stack settles in under 2 s.
- `roi/resolve` for the longest river + 10 km under 0.35 s; select-within on it under 0.5 s.
- Versioning suite under 45 s; API suite under 70 s.
- During a basemap rebuild, a tile-cache miss on the table being reloaded waits under 1 s.
- Popups, ROI candidates, editing and analysis behave as before (existing tests pass unchanged, plus new tests for the tile endpoint and the edit-geometry fetch).

## Out of scope

- River edit save time (the incremental hierarchy rebuild): next candidate.
- Splitting the web bundle (O3): the web restructure group.
- A server-side tile cache for the API tiles.
- Vector tiles for dams and the small thematic layers.
