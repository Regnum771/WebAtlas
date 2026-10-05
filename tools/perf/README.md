# Performance measurements

Scripts that produced the baseline in `docs/superpowers/specs/2026-10-05-measure-first-optimisation-design.md`. Re-run them unchanged after the optimisation group so the "after" numbers are comparable. Each script's docstring explains its output columns.

## Setup (dev stack)

- Docker containers `webatlas-db-1` and `webatlas-geoserver-1` running.
- API: `npm run dev -w @webatlas/api` (port 3001). For `page.mjs`, start it with `CORS_ORIGIN=http://127.0.0.1:4173` in the environment, so it accepts requests from the preview page.
- Web, production build (needed only for `page.mjs`): `VITE_API_BASE_URL=http://127.0.0.1:3001 npm run build -w @webatlas/web`, then `cd apps/web && npx vite preview --host 127.0.0.1 --port 4173`.
- `page.mjs` needs `puppeteer-core` (repo root `node_modules`) and system Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (override with `CHROME_PATH`).

**Check the `api` group in `page.mjs`'s output.** Without the two settings above, every API request fails on CORS, the water layers are not drawn, and the script still prints plausible numbers. `"failed": 0` in the `api` group is what makes a run valid.

## Run

```
python3 tools/perf/wfs.py     # GeoServer WFS per layer and view: cold/warm seconds, bytes, gzip, features
python3 tools/perf/tiles.py   # GWC WMTS tiles: first vs repeat request, cache hits
python3 tools/perf/api.py     # API requests: first / median / max of 5 runs
node tools/perf/page.mjs      # headless Chrome: first load and zoom 7 -> 11
```

Base URLs come from `WEBATLAS_GEOSERVER` (default `http://127.0.0.1:8080/geoserver`), `WEBATLAS_API` (default `http://127.0.0.1:3001/api`) and `WEBATLAS_WEB` (default `http://127.0.0.1:4173/`). `api.py` looks its feature ids up through `docker exec webatlas-db-1 psql`.

## The 127.0.0.1 rule

Always use `127.0.0.1`, never `localhost`. On this Windows machine `localhost` resolves to IPv6 first while the API listens on IPv4, so a non-browser client pays a 2 s fallback per request that browsers do not. Using `localhost` would inflate every number.

## Baseline (2026-10-05, after S1)

Dev stack. Map times are from headless Chrome against the production build; everything else from timed HTTP requests. Each number is a median of repeated runs unless marked "cold".

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

Ruled out by the numbers: GeoServer already gzips WFS responses (about 7x); cached tiles answer in 5–20 ms; the assistant's latency is dominated by model calls, and its database work is the analysis numbers above.

## After the optimisation group (2026-10-05, branch `perf/measure-first`)

Same machine and scripts, after a forced basemap rebuild and its tile-cache seed had finished. Page numbers are from four `page.mjs` runs; the rest are the scripts' medians.

| What a user does | Before | After | Target | Met |
|---|---|---|---|---|
| Open the app on a warm tile cache | map quiet 1.3 s after load | 0.67–1.29 s (median 0.98 s) | — | — |
| Open the app after a basemap rebuild | single tiles up to 4 s; map quiet after ~4.6 s | the five basemap groups at zooms 9, 11, 12: 16/16 cache hits each, medians 8–22 ms; map quiet as above | all hits; settle under 2 s | yes |
| Far-zoom river layer | 0.8–1.0 s per WFS request | 4–10 ms per tile, 53 ms worst | under 0.1 s per tile | yes |
| Zoom 7 → 11, cold browser cache | 2–6 s to settle | 1.27–1.88 s (median 1.57 s) | under 2 s | yes |
| Zoom 7 → 11, warm browser cache | — | 0.66, 0.67, 0.87 and 1.69 s | under 1 s | three runs of four |
| Longest main-thread task while zooming | up to 315 ms | 60–104 ms over eight sessions; one over 100 ms | none over 100 ms | seven sessions of eight |
| `roi/resolve`, longest river + 10 km | 0.94 s | 0.14 s (first request 0.25 s) | under 0.35 s | yes |
| `select_within` on that region | 0.98 s | 0.21 s | under 0.5 s | yes |
| Versioning test suite | ~110 s | 97 s | under 45 s | **no** |
| API test suite | ~100 s | 81 s | under 70 s | **no** |
| Tile-cache miss during a basemap rebuild | up to ~4 min | 0.36 s worst of 298 misses during the load; no lock waits | under 1 s | yes |

What the table does not show:

- **Rivers, lakes, the far-zoom rivers and the ward boundaries no longer come from WFS.** `wfs.py` still times those WFS layers (unchanged: rivers 1.5–1.7 s at zoom 7), but the web app now draws them from `GET /api/tiles/...`. API tiles around Buôn Ma Thuột take 4–44 ms (median per layer and zoom) and are 1–21 kB gzipped.
- **The two suite targets were not reached.** The versioning suite's floor is the river activations on the pinned hierarchy builder; getting under 45 s needs the incremental hierarchy work that this group deferred. The API suite now runs its files without per-file isolation (`isolate: false`), except the two that mock modules.
- **For about three minutes after a basemap rebuild, uncached tiles are slower** (up to 2.6 s measured, at zoom 17) because the background seed is rendering with two threads per group. That is the seed doing its job, not the load holding a lock.
- **Rivers and lakes are no longer snap targets** when drawing.

How the rebuild number was taken: `npm run atlas:build -- --force basemap` while a loop requested one new zoom-17 `basemap_roads` metatile per second near Buôn Ma Thuột and another sampled `pg_stat_activity` every 250 ms for sessions waiting on a lock. An earlier run without the lock sampling saw one 4.9 s wait on a busier machine; this run shows no lock wait at any point, including the swap of `roads_region`.

## Notes

- `api.py` sends about 90 requests, 40 of them to `/analysis/*`, which the API rate-limits to 60 per minute (100 per minute overall). Run it once per minute; a second run inside the window returns 429 for the analysis cases.
- Three `api.py` cases were adjusted when the script was committed: the dams list was dropped (it answers 401 without a login), admin units are requested with `?level=province`, and the lake case selects within the lake's own area, without a radius.
- `tiles.py` requests a 4×4 block that, for the contour layers at zoom 9, reaches outside their published extent; those tiles answer HTTP 400 and are averaged into `kB/tile`. Read the contour rows at zoom 9 as 12 tiles, not 16.
- Run each script once to warm up before taking numbers (JIT, connection pools, OS file cache), and avoid running them straight after starting Docker.
