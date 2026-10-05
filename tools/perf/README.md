# Performance measurements

Scripts that produced the baseline in `docs/superpowers/specs/2026-10-05-measure-first-optimisation-design.md`. Re-run them unchanged after the optimisation group so the "after" numbers are comparable. Each script's docstring explains its output columns.

## Setup (dev stack)

- Docker containers `webatlas-db-1` and `webatlas-geoserver-1` running.
- API: `npm run dev -w @webatlas/api` (port 3001).
- Web, production build (needed only for `page.mjs`): `npm run build -w @webatlas/web`, then `cd apps/web && npx vite preview --host 127.0.0.1 --port 4173`.
- `page.mjs` needs `puppeteer-core` (repo root `node_modules`) and system Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

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

## Notes

- `api.py` sends about 90 requests, 30 of them to `/analysis/*`, which the API rate-limits to 60 per minute (100 per minute overall). Run it once per minute; a second run inside the window returns 429 for the analysis cases.
- Run each script once to warm up before taking numbers (JIT, connection pools, OS file cache), and avoid running them straight after starting Docker.
