# Flood Scenario Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay the 26–31/10/2025 Vu Gia – Thu Bồn flood as a playable scenario (KTTV bulletin 21:00 28/10 as "the forecast"), with presets, affected roads and xã over time, and an evacuation plan the assistant can run and draw.

**Architecture:** A Python script in the `atlas-tools` container computes every scenario offline (hourly levels → bathtub flood on FABDEM → exposure → plan) into a `scenario` PostGIS schema. A read-only Fastify module serves it; the web app plays it in a bottom dock; five assistant tools query the same module and emit three new map commands.

**Tech Stack:** Python 3.11 (numpy, scipy, rasterio, geopandas, SQLAlchemy) · Fastify + pg · React 19 + OpenLayers 10 · Anthropic SDK `betaZodTool` · vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-flood-scenario-demo-design.md` (commit 65d4e90). Read it first; this plan does not repeat its tables.

**Deadline:** demo 2026-10-16 10:00. Tasks are ordered so the demo path works end to end after Task 7. Task 9 (past floods) is cut first.

## Global Constraints

- Branch `feat/flood-scenario-demo`. Do not commit the uncommitted basemap files on it (`packages/atlas-data/tools/basemap/*`, `packages/shared/src/layer-palette.ts`, `packages/shared/src/legend.test.ts`); stage only your own files.
- Code comments in English; UI strings, API messages and the assistant prompt in Vietnamese; commit messages Vietnamese Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Area box: 107.95–108.40 °E, 15.70–15.98 °N. All geometry EPSG:4326.
- Scenario ids exactly: `kttv-2025-10`, `preset-500`, `preset-1000`, `preset-1300`. Start 2025-10-27T21:00+07:00, 96 hours (hours 0–96, 97 frames), bulletin hour 24.
- Time zone: clock times are Asia/Ho_Chi_Minh (fixed UTC+7), shown as `HH:mm DD/MM/YYYY`.
- Every surface says what is recorded and what is computed: "Mực nước thực đo KTTV" / "Ước tính từ lũ 10/2025" / "ngập: mô phỏng nhanh trên FABDEM".
- Thresholds: road cut at depth ≥ 0.3 m; building wet at ≥ 0.2 m; 4 people per flooded building; deadline = first hour − 3 (floor 0); xã first hour = first hour at which ≥ 5 % of its buildings are wet, else its earliest wet building.
- The flood is a raster (spec F8): one transparent PNG per scenario and hour, EPSG:3857, continuous ramp 0 → 4 m from `#c6dbef` through `#4292c6` to `#08306b`, alpha 190, dry cells alpha 0; ≥ 4 m takes the 4 m colour. Files at `packages/atlas-data/data/cache/flood/frames/<scenario>/<hour:03d>.png`.
- After editing `packages/shared/src/*`, run `npm run build:shared` and commit the regenerated `dist` (new files need `git add -f packages/shared/dist/<file>.js packages/shared/dist/<file>.d.ts`).
- No new web dependencies; the chart is hand-drawn SVG.

## Review Focus

1. The assistant asks for an hour outside 0–96 → the tool clamps and says "đã giới hạn về giờ …" (Task 5 test).
2. An hour at which nothing is wet yet (`preset-500`, hour 0) → impacts answer "chưa có tuyến đường hay xã nào bị ngập" instead of an empty list (Task 5 test).
3. Switching scenario while playing → playback stops and the hour goes to the bulletin hour (Task 6 test).
4. A frame fails to preload (or 97 requests trip a rate limit) → the dock shows "Không tải được kịch bản lũ." and "Thử lại", and the slider is disabled; the frames route has its own limit so a preload never 429s (Task 4 and Task 7 tests).
5. The `scenario` schema is missing (script never run) → `GET /api/scenarios` returns `[]`, not 500 (Task 4 test).

---

### Task 1: Station readings and hourly level series

**Files:**
- Create: `packages/atlas-data/data/seeds/flood-2025-10-levels.csv`
- Create: `packages/atlas-data/tools/flood_scenario/levels.py`
- Test: `packages/atlas-data/tools/flood_scenario/test_levels.py`

**Interfaces:**
- Produces (Python, used by Task 3):
  - `STATIONS: list[dict]` — keys `id, name, river, bd1, bd2, bd3, record_m, record_year, derived, lon, lat` (values from the spec's Stations table; coordinates: `ai-nghia` 108.118, 15.878; `giao-thuy` 108.100, 15.836; `cau-lau` 108.287, 15.863; `hoi-an` 108.333, 15.876 — approximate).
  - `SCENARIOS: list[dict]` — keys `id, name, kind, rain_total_mm, basis` (names from the spec's Scenarios table).
  - `START: datetime` (2025-10-27 21:00 +07:00), `HOURS = 96`, `BULLETIN_HOUR = 24`.
  - `load_readings(path: str) -> dict[str, list[tuple[datetime, float]]]` — recorded readings per station id.
  - `load_forecast(path: str) -> dict[str, list[tuple[datetime, float]]]` — the 21:00 28/10 bulletin's forecast points.
  - `hourly_series(readings: list[tuple[datetime, float]], start: datetime, hours: int) -> list[float]` — linear interpolation; before the first / after the last reading holds the end value.
  - `derive_hoi_an(cau_lau: float) -> float` = `2.0 + (cau_lau - 4.0) * 0.94`
  - `derive_giao_thuy(ai_nghia: float) -> float` = `ai_nghia - 0.5`
  - `scale_series(series: list[float], base: float, rain_mm: float, event_mm: float = 1000, exponent: float = 0.6) -> list[float]` = `base + (v - base) * (rain_mm / event_mm) ** exponent`
  - `BASES = {"ai-nghia": 7.04, "cau-lau": 2.31}` (pre-event levels per spec: 21:00 27/10 value minus 3 m / 2.5 m).
  - `scenario_levels(scenario_id: str, readings) -> dict[str, list[float]]` — four stations × 97 values; presets scale Ái Nghĩa and Câu Lâu, then derive Hội An and Giao Thủy from the scaled values.
  - `BULLETIN_AT_RISK: list[str]` — xã names listed at flood risk in the 21:00 28/10 bulletin.

- [ ] **Step 1: Fill the CSV from the bulletins.** Columns `station_id,time,level_m,kind,source` (`kind` = `recorded` or `forecast`; `source` = bulletin file name). Extract every Ái Nghĩa and Câu Lâu reading from the 14 PDFs in the session scratchpad `dl-kttv/` (pypdf in the tools container), including the rows the spec marks "(to extract)" and the 21:00 28/10 forecast table (5 points per station, 6-hour steps from 03:00 29/10). Check each value against the PDF text by eye. Put `BULLETIN_AT_RISK` (xã list from the same bulletin, Phụ lục) in `levels.py`.

- [ ] **Step 2: Write the failing tests** (same `check(name, cond)` style as `basemap/test_load_basemap.py`, no pytest):

```python
s = levels.hourly_series([(T0, 4.81), (T0 + timedelta(hours=24), 5.11)], T0, 24)
check("interpolates linearly", abs(s[12] - 4.96) < 1e-9)
check("holds the last value", levels.hourly_series([(T0, 1.0)], T0, 3) == [1.0, 1.0, 1.0, 1.0])
check("hoi an at BD3", abs(levels.derive_hoi_an(4.0) - 2.0) < 1e-9)
check("hoi an at 5.6", abs(levels.derive_hoi_an(5.6) - 3.504) < 1e-9)
check("1000 mm is the event", levels.scale_series([2.31, 5.62], 2.31, 1000) == [2.31, 5.62])
check("500 mm scales the rise", abs(levels.scale_series([5.62], 2.31, 500)[0] - (2.31 + 3.31 * 0.5 ** 0.6)) < 1e-9)
lv = levels.scenario_levels("kttv-2025-10", levels.load_readings(CSV))
check("97 values per station", all(len(v) == 97 for v in lv.values()))
check("peak at Cau Lau is 5.62", abs(max(lv["cau-lau"]) - 5.62) < 1e-9)
```

- [ ] **Step 3: Run, expect FAIL:** `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/flood_scenario/test_levels.py` → import error.
- [ ] **Step 4: Implement `levels.py`.**
- [ ] **Step 5: Run again, expect every line `ok`.**
- [ ] **Step 6: Commit** `feat(atlas-data): mực nước thực đo lũ 10/2025 và chuỗi giờ cho kịch bản lũ`.

### Task 2: Flood depth on a grid

**Files:**
- Create: `packages/atlas-data/tools/flood_scenario/depth.py`
- Test: `packages/atlas-data/tools/flood_scenario/test_depth.py`
- Modify: `packages/atlas-data/tools/requirements.txt` (add `scipy==1.14.1`), `packages/atlas-data/tools/Dockerfile` (add `scipy` to the import check)

**Interfaces:**
- Produces (used by Task 3):
  - `water_surface(levels: dict[str, float], station_rc: dict[str, tuple[float, float]], shape: tuple[int, int], power: float = 2.0) -> np.ndarray` — inverse-distance-weighted surface (float32) from station levels at fractional (row, col).
  - `flood_depth(surface: np.ndarray, dem: np.ndarray, channel: np.ndarray) -> np.ndarray` — `surface - dem` where positive, kept only for 8-connected wet components that touch `channel` (bool); NaN in `dem` → 0.
  - `depth_rgba(depth: np.ndarray, max_m: float = 4.0) -> np.ndarray` (uint8, H×W×4, ramp per Global Constraints; band order R, G, B, A).

- [ ] **Step 1: Add scipy, rebuild the image:** `docker compose -f infra/docker-compose.yml --profile tools build tools`; expect the build's import check to pass.
- [ ] **Step 2: Write the failing tests:**

```python
dem = np.array([[0, 0, 9, 0, 0]] * 3, dtype="float32")    # a ridge at col 2
channel = np.zeros_like(dem, bool); channel[:, 0] = True
d = depth.flood_depth(np.full(dem.shape, 1.0, "float32"), dem, channel)
check("connected side is wet", d[1, 1] == 1.0)
check("cut-off hollow stays dry", d[1, 4] == 0.0)
check("ridge is dry", d[1, 2] == 0.0)
check("nan ground is dry", depth.flood_depth(np.array([[2.0]], "float32"), np.array([[np.nan]], "float32"), np.array([[True]]))[0, 0] == 0.0)
rgba = depth.depth_rgba(np.array([[0.0, 0.3, 2.0, 4.0, 9.0]], "float32"))
check("dry is transparent", rgba[0, 0, 3] == 0)
check("wet is drawn", rgba[0, 1, 3] == 190)
lum = lambda p: 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
check("deeper is darker", lum(rgba[0, 1]) > lum(rgba[0, 2]) > lum(rgba[0, 3]))
check("capped at max", (rgba[0, 3] == rgba[0, 4]).all())
s = depth.water_surface({"a": 10.0, "b": 2.0}, {"a": (0, 0), "b": (0, 4)}, (1, 5))
check("surface falls a to b", s[0, 0] > s[0, 2] > s[0, 4])
```

- [ ] **Step 3: Run, expect FAIL.** `... tools python3 packages/atlas-data/tools/flood_scenario/test_depth.py`
- [ ] **Step 4: Implement `depth.py`** (`scipy.ndimage.label` with a 3×3 structure for connectivity; a station sitting exactly on a cell takes its own level).
- [ ] **Step 5: Run, expect all `ok`.**
- [ ] **Step 6: Commit** `feat(atlas-data): tính độ sâu ngập theo mặt nước nội suy trên DEM`.

### Task 3: Build script → `scenario` schema

**Files:**
- Create: `packages/atlas-data/tools/flood_scenario/build_scenarios.py` (orchestration, DB I/O)
- Create: `packages/atlas-data/tools/flood_scenario/exposure.py` (roads, buildings, xã, shelters, plan)
- Create: `docs/runbooks/flood-scenario-demo.md` (how to run it; what each check means)

**Interfaces:**
- Consumes: Task 1 and Task 2 functions.
- Produces: the tables of the spec's Storage section, exactly those names and columns, plus `scenario.flood_scenario.bulletin_hour` = 24 and `start_time` timestamptz; the PNG frames on disk. `flood_series.forecast_m` holds the bulletin's points at their hours (rounded to the nearest hour), null elsewhere. Indexes: `(scenario_id, hour)` on `flood_hourly`, `flood_series`; `scenario_id` on `flood_road`, `flood_ward`, `flood_plan`.

- [ ] **Step 1: Inputs.** DEM: `SELECT ST_AsGDALRaster(ST_Union(ST_Clip(rast, env)), 'GTiff') FROM basemap.dem_region, (SELECT ST_MakeEnvelope(107.95,15.70,108.40,15.98,4326) env) e WHERE ST_Intersects(rast, env)` into a `rasterio.MemoryFile`. OSM from `/vsizip/packages/atlas-data/data/cache/basemap/vietnam-261001-free.shp.zip/<layer>.shp` read with `bbox=` (roads, buildings_a, waterways, water_a, pois, pois_a). Xã from `packages/atlas-data/data/seeds/wards-region.geojson`. Channel mask: rasterize waterways `fclass in ('river','canal')` buffered 1 cell, plus water_a `fclass in ('water','river','reservoir')`.
- [ ] **Step 2: Per scenario, per hour 0–96:** levels → `water_surface` → `flood_depth` → keep running arrays `first_cut` (≥ 0.3), `first_wet` (≥ 0.2) and `max_depth`; insert `flooded_km2` (wet cells × cell area at the box's mid-latitude) into `flood_hourly`; warp the depth grid to EPSG:3857 once-computed target grid (`rasterio.warp.calculate_default_transform` for the box, `reproject` with bilinear) and write `depth_rgba` with the GDAL `PNG` driver (4 bands, uint8) to the frames path. Store the 3857 extent in `flood_scenario.frame_extent`. `preset-1000` copies `kttv-2025-10`'s rows and frame files (same levels) instead of recomputing.
- [ ] **Step 3: Exposure (`exposure.py`).** Roads: fclass list from the spec; sample every 30 m in EPSG:32649; `cut_hour` = min `first_cut` over samples. Buildings: centroid lookups. Xã: aggregates per Global Constraints; only xã with ≥ 1 flooded building get rows. Shelters: spec fclass list from pois + pois_a centroids, dry under `preset-1300`. Plan: per affected xã — priority (deadline asc, people desc), nearest shelter by EPSG:32649 distance, up to five distinct road names inside the xã with `cut_hour` null or > deadline (ordered motorway…residential), arrow from flooded-building centroid to shelter.
- [ ] **Step 4: Checks printed at the end** (the run fails with a non-zero exit if a check marked hard fails):
  - per scenario: peak flooded area km² and its hour; hard check for `kttv-2025-10`: 40 ≤ area ≤ 400 km².
  - wet xã at the peak of `kttv-2025-10` vs `BULLETIN_AT_RISK`: matched / missing / extra (printed, not hard).
  - frames: 97 files per scenario; total bytes per scenario printed; hard check ≤ 25 MB.
- [ ] **Step 5: Run:** `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/flood_scenario/build_scenarios.py` → all hard checks `ok`; then `psql` count rows in each table (non-zero except `flood_history`).
- [ ] **Step 6: Write the runbook** (command, duration, what the checks mean, that results are a bathtub approximation).
- [ ] **Step 7: Commit** `feat(atlas-data): dựng sẵn kịch bản lũ 10/2025 — khung ngập theo giờ, đường, xã, điểm tập kết, phương án sơ tán`.

### Task 4: Shared types and the scenarios API

**Files:**
- Create: `packages/shared/src/flood.ts` (+ export from `packages/shared/src/index.ts`)
- Modify: `packages/shared/src/map-commands.ts` (three commands + `isMapCommand` branches), `packages/shared/src/map-commands.test.ts`
- Create: `apps/api/src/modules/scenarios/{repository.ts,controller.ts,routes.ts,scenarios.test.ts}`
- Modify: `apps/api/src/server.ts` (register `scenariosRoutes` with prefix `/api`)

**Interfaces:**
- Produces (shared):
  - `FLOOD_SCENARIO_IDS = ['kttv-2025-10','preset-500','preset-1000','preset-1300'] as const`; `type FloodScenarioId`.
  - `interface FloodScenarioSummary { id: FloodScenarioId; name: string; kind: 'kttv' | 'preset'; rainTotalMm: number | null; startTime: string; hours: number; bulletinHour: number; basis: string }`
  - `interface FloodStation { id: string; name: string; river: string; bd1: number; bd2: number; bd3: number; recordM: number | null; recordYear: number | null; derived: boolean }`
  - `interface FloodScenarioDetail extends FloodScenarioSummary { stations: FloodStation[]; series: Record<string, { level: number[]; forecast: (number | null)[] }>; floodedKm2: number[]; frameExtent: [number, number, number, number] /* EPSG:3857 */ }`
  - `interface FloodImpacts { hour: number; time: string; roads: { name: string | null; ref: string | null; fclass: string; cutHour: number; cutTime: string; maxDepth: number }[]; wards: { code: string; name: string; firstHour: number; firstTime: string; buildingsFlooded: number; peopleEst: number; maxDepth: number }[]; totals: { roadsCut: number; wardsWet: number; buildingsFlooded: number; peopleEst: number } }`
  - `interface FloodPlanRow { priority: number; wardCode: string; wardName: string; deadlineHour: number; deadlineTime: string; alreadyWet: boolean; peopleEst: number; shelter: { id: string; name: string | null; kind: string; lonLat: [number, number] }; distanceM: number; openRoads: string[]; arrow: GeoJsonGeometry }`
  - `formatScenarioTime(startIso: string, hour: number): string` → `"21:00 28/10/2025"` for (`2025-10-27T21:00:00+07:00`, 24).
  - MapCommand additions: `{ kind: 'showFloodScenario'; scenarioId: FloodScenarioId; hour?: number; play?: boolean }`, `{ kind: 'showEvacuationPlan'; scenarioId: FloodScenarioId }`, `{ kind: 'clearFloodScenario' }`.
- Produces (API, `apps/api/src/modules/scenarios/repository.ts`, also used by Task 5):
  - `listScenarios(pool): Promise<FloodScenarioSummary[]>` (`[]` on Postgres `42P01`)
  - `getScenario(pool, id): Promise<FloodScenarioDetail | null>`
  - `framePath(id: FloodScenarioId, hour: number): string` — `<FLOOD_FRAMES_DIR>/<id>/<hour:03d>.png`; `FLOOD_FRAMES_DIR` is a new optional env in `apps/api/src/config/env.ts`, defaulting to the repo's `packages/atlas-data/data/cache/flood/frames` resolved from the API's cwd.
  - `getImpacts(pool, id, hour): Promise<FloodImpacts>` (roads with `cut_hour <= hour`, xã with `first_hour <= hour`; ordered by hour then name; roads unnamed grouped out of the list but counted in totals)
  - `getPlan(pool, id): Promise<FloodPlanRow[]>` ordered by priority; `alreadyWet` = `first_hour = 0`.
- Routes: `GET /api/scenarios`, `GET /api/scenarios/:id`, `GET /api/scenarios/:id/frames/:hour` (PNG, `Content-Type: image/png`, `Cache-Control: public, max-age=3600`, `config: { rateLimit: { max: 3000, timeWindow: '1 minute' } }` as in `elevation/routes.ts`; id checked against `FLOOD_SCENARIO_IDS` and hour as an integer before any path is built; missing file → 404), `GET /api/scenarios/:id/impacts?hour=`, `GET /api/scenarios/:id/plan`. Unknown id → 404 `"Không có kịch bản lũ này."`. `hour` validated as integer and clamped to `0..hours`.

- [ ] **Step 1: Failing tests.** Shared: `formatScenarioTime('2025-10-27T21:00:00+07:00', 24) === '21:00 28/10/2025'`; `isMapCommand({kind:'showFloodScenario', scenarioId:'kttv-2025-10', hour: 30})` true, with `scenarioId:'x'` false, `hour: -1` false. API (`scenarios.test.ts`, live DB like `elevation.test.ts`; `describe.skipIf(!hasScenarioSchema)` with the reason printed): list returns 4 ids; `/scenarios/nope` → 404 with the message; `/scenarios/kttv-2025-10/impacts?hour=999` → `hour` 96; `/plan` priorities strictly increasing from 1; `/frames/24` returns `image/png`; `/frames/..%2F..%2Fx` and `/frames/abc` → 400/404 without touching the disk; 150 sequential frame requests from one client all return 200 (no 429); missing schema → `listScenarios` returns `[]` (test against a pool on a throwaway schema name or by stubbing the query to throw `{ code: '42P01' }`).
- [ ] **Step 2: Run, expect FAIL:** `npm run test -w @webatlas/shared` and `npm run test -w @webatlas/api -- scenarios`.
- [ ] **Step 3: Implement** shared, repository, controller (zod via `lib/validate`), routes, registration. `npm run build:shared`.
- [ ] **Step 4: Run, expect PASS**; `curl -sI localhost:3001/api/scenarios/kttv-2025-10/frames/24` shows `image/png`.
- [ ] **Step 5: Commit** `feat(api): đọc kịch bản lũ — danh sách, chuỗi mực nước, khung ngập, ảnh hưởng theo giờ, phương án sơ tán`.

### Task 5: Assistant tools and evacuation guidance

**Files:**
- Create: `apps/api/src/modules/assistant/tools/data/floodScenario.ts` (four factories)
- Create: `apps/api/src/modules/assistant/tools/data/floodScenario.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts` (append after `featuresInAdminUnitTool`, in this order), `apps/api/src/modules/assistant/prompt.ts` (rule 9), `apps/api/src/modules/assistant/prompt.test.ts`

**Interfaces:**
- Consumes: Task 4 repository functions and shared types.
- Produces tools: `listFloodScenariosTool` (`list_flood_scenarios`, no input), `runFloodScenarioTool` (`run_flood_scenario {scenarioId: enum FLOOD_SCENARIO_IDS, hour?: int}`), `floodImpactsTool` (`flood_impacts {scenarioId, hour: int}`), `evacuationPlanTool` (`evacuation_plan {scenarioId}`).
  - `run_flood_scenario` collects `showFloodScenario` (hour default = bulletin hour, `play: false`) and returns: basis line, per station peak level and time vs BĐ3 and record, the bulletin's forecast peak vs recorded peak, flooded km² every 6 h.
  - `flood_impacts` collects `showFloodScenario {hour}` and returns roads (up to 30, then "và N tuyến khác") and xã with clock times and totals; out-of-range hour → clamped, text starts "Đã giới hạn về giờ {h} ({time})."; nothing wet → "Đến {time} chưa có tuyến đường hay xã nào bị ngập trong kịch bản này."
  - `evacuation_plan` collects `showEvacuationPlan` and `showFloodScenario {hour: earliest deadline}`; returns the rows (xã, deadline time or "đã ngập — cứu hộ", people, gathering point, distance km, open roads).
  - Each calls `ctx.provenance({ tool, layerKey: null, rowCount, datasetVersion: '<basis>' })` with basis "Mực nước thực đo: Trung tâm Dự báo KTTV quốc gia; ngập: mô phỏng nhanh trên FABDEM" (presets: "Ước tính từ lũ 10/2025; ngập: mô phỏng nhanh trên FABDEM").
- Prompt rule 9 (Vietnamese, stable text, in `BASE_RULES`): for flood/evacuation questions use the flood tools; order by deadline; xã already wet need rescue; finish before the deadline; use only roads still open; prioritise elderly, children, single-storey houses near the river; "4 tại chỗ"; state what is recorded vs simulated.

- [ ] **Step 1: Failing tests** with a stub pool (pattern of `data.test.ts`): `run_flood_scenario` with no hour collects `{kind:'showFloodScenario', scenarioId:'kttv-2025-10', hour:24, play:false}`; `flood_impacts` hour 500 → text starts "Đã giới hạn về giờ 96"; empty impacts → the "chưa có tuyến đường hay xã nào" sentence; `evacuation_plan` collects both commands and its provenance `rowCount` equals the rows; prompt contains "4 tại chỗ"; registry order test updated with the four names at the end.
- [ ] **Step 2: Run, expect FAIL:** `npm run test -w @webatlas/api -- floodScenario prompt registry`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(api): Trợ lý chạy kịch bản lũ, liệt kê đường và xã bị ngập theo giờ, đề xuất phương án sơ tán`.

### Task 6: Web store, playback and map layers

**Files:**
- Create: `apps/web/src/features/flood-scenario/api/flood.api.ts`
- Create: `apps/web/src/features/flood-scenario/model/flood.store.ts` (+ `.test.ts`)
- Create: `apps/web/src/features/flood-scenario/model/floodLayers.ts` (+ `.test.ts`)
- Modify: `apps/web/src/features/map/model/mapCommands.ts` (+ `.test.ts`), `apps/web/src/features/shell/model/shell.store.ts` (`ToolId` gains `'flood'`)

**Interfaces:**
- Consumes: Task 4 routes and shared types.
- Produces:
  - `flood.api.ts`: `fetchScenarios()`, `fetchScenario(id)`, `frameUrl(id, hour): string`, `preloadFrames(id, hours, onProgress: (loaded: number) => void): Promise<void>` (6 at a time via `Image()`; rejects on the first failed frame), `fetchImpacts(id, hour)`, `fetchPlan(id)` (same fetch helper the other `*.api.ts` use).
  - `flood.store.ts` (module store with `useSyncExternalStore`, like `roi.store.ts`): state `{ scenarioId: FloodScenarioId | null; hour: number; playing: boolean; speed: 1 | 2 | 4; planShown: boolean; status: 'idle' | 'loading' | 'ready' | 'error'; loaded: number; error: string | null; detail: FloodScenarioDetail | null }`; actions `openScenario(id, hour?, play?)`, `setHour(h)` (clamped to 0..hours), `play()`, `pause()`, `setSpeed(s)`, `tick()` (advances `speed` hours; pauses at the last hour), `showPlan(id)`, `closeScenario()`, `retry()`; `useFloodScenario()`.
  - Switching to another scenario: `playing=false`, `hour = hour ?? bulletinHour`, `planShown=false`.
  - `floodLayers.ts`: `syncFloodLayers(map, { scenarioId, frameExtent, roads, plan, hour })` draws the frame as an `ImageLayer` with an `ImageStatic` source (`url: frameUrl(id, hour)`, `imageExtent: frameExtent`, `projection: 'EPSG:3857'`, `interpolate: false`) at zIndex 990, replacing the source only when the hour changes; then on vector layers at zIndex 991–994: roads with `cutHour <= hour` red `#d7301f` 3 px, later orange `#fd8d3c` 2 px; plan shelters (numbered circles) and arrows (dark ink `#18213A`, arrowhead); `clearFloodLayers(map)`. `openScenario` fetches the detail, then `preloadFrames`, updating `loaded`; `status` is `ready` only when all 97 are in.
  - `mapCommands.ts` cases: `showFloodScenario` → `openTool('flood')` + `openScenario(...)`; `showEvacuationPlan` → `showPlan(id)`; `clearFloodScenario` → `closeScenario()`; texts "Đã mở kịch bản lũ.", "Đã vẽ phương án sơ tán.", "Đã đóng kịch bản lũ.".

- [ ] **Step 1: Failing tests** (store, with `flood.api` mocked): a preload rejecting → `status` `error` with "Không tải được kịch bản lũ."; progress updates `loaded`; `setHour(500)` on a 96-hour scenario → 96; `tick()` at speed 4 from 94 → 96 and `playing` false; switching scenario while playing → `playing` false and `hour` 24; `retry()` after an error refetches. Map commands: `showFloodScenario` opens tool `'flood'`.
- [ ] **Step 2: Run, expect FAIL:** `npm run test -w @webatlas/web -- flood mapCommands`.
- [ ] **Step 3: Implement.** The play loop is a `setInterval(tick, 1000)` owned by the store while `playing`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(web): trạng thái và lớp bản đồ cho kịch bản lũ, chạy theo giờ`.

### Task 7: Kịch bản lũ dock

**Files:**
- Create: `apps/web/src/features/flood-scenario/ui/FloodDock.view.tsx` (+ `.test.tsx`), `apps/web/src/features/flood-scenario/ui/LevelChart.view.tsx`, `apps/web/src/features/flood-scenario/index.tsx` (container wiring store ↔ view ↔ `syncFloodLayers`)
- Modify: `apps/web/src/app/MapScreen.tsx` (tool `{ id: 'flood', label: 'Kịch bản lũ', on: scenarioId !== null, content: <FloodScenarioToolContent/> }` holding the picker; `<FloodDock/>` rendered in `stage` after `ScaleSlider` when a scenario is open), the CSS file the shell views use (dock along the bottom of `.map-stage`, full width minus the scale column, above `ToastHost`), `apps/web/src/features/legend/*` (a gradient bar for depth labelled 0 · 0,5 · 1 · 2 · ≥ 4 m, rows for cut/later roads, shelters, arrows, and the basis/credits line)

**Interfaces:**
- Consumes: Task 6 store and layers.
- Produces: `FloodDockView` props `{ scenarios, scenarioId, detail, hour, playing, speed, status, error, stationId, onScenario, onHour, onPlay, onPause, onSpeed, onStation, onRetry, onClose }`; `LevelChartView` props `{ station: FloodStation; level: number[]; forecast: (number | null)[]; hour: number; bulletinHour: number }` drawing level line, BĐ1–3 dashed, record dotted, forecast markers, a cursor at `hour`, and the bulletin hour marker.
- Copy: title "Kịch bản lũ"; basis line under the picker; slider label `"{time}"` with "Bản tin dự báo" at the bulletin mark; buttons "Phát", "Tạm dừng", "1×", "2×", "4×", "Đóng"; empty "Chưa có dữ liệu kịch bản"; loading "Đang tải khung ngập {loaded}/97"; error "Không tải được kịch bản lũ." + "Thử lại".

- [ ] **Step 1: Failing view tests:** status `error` renders "Thử lại" and the slider `disabled`; empty list renders "Chưa có dữ liệu kịch bản"; slider `aria-valuetext` equals `formatScenarioTime(start, hour)`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, then `npm run build:web` (type check) and `npm run lint:web`.
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** `feat(web): khay Kịch bản lũ — chọn kịch bản, biểu đồ mực nước, thanh thời gian phát lại`.

### Task 8: Demo rehearsal in the browser

**Files:**
- Create: `apps/web/scripts/rehearse-flood-demo.mjs` (puppeteer-core, pattern of `verify:shell`)
- Modify: `apps/api/.env` locally only (not committed): `ASSISTANT_MODEL=claude-sonnet-5-5`

**Interfaces:** consumes everything above.

- [ ] **Step 1: Start the stack** (db, geoserver, API, `npm run dev:web`) per the `dev-run-environment` memory.
- [ ] **Step 2: Script the demo** (spec "Demo script" steps 1–4): open Kịch bản lũ, pick `kttv-2025-10`, play 5 s, sign in, ask the two questions, switch to `preset-1300`, ask again. Screenshot after each step into the scratchpad after tile traffic is quiet.
- [ ] **Step 3: Look at every screenshot.** Check: flood blues visible on cream basemap, the dock does not cover the scale column or the assistant, arrows and numbered shelters readable, the answers name roads and xã with times and say what is simulated.
- [ ] **Step 4: Fix what the screenshots show; rerun until clean.**
- [ ] **Step 5: Commit** `test(web): kịch bản tập dượt demo kịch bản lũ trên trình duyệt`.

### Task 9 (cut first): Past floods from satellite

**Files:**
- Create: `packages/atlas-data/tools/flood_scenario/load_history.py`
- Modify: `apps/api/src/modules/scenarios/{repository.ts,routes.ts}` (`GET /api/flood-history`, `historyAt(pool, wardCode | roadName)`), `apps/api/src/modules/assistant/tools/data/floodScenario.ts` (`floodHistoryTool`, `flood_history {place: string}` appended last), the dock (a "So sánh lũ lịch sử" checklist) and `floodLayers.ts` (outline layer, zIndex 989, dashed `#54278f`)

**Interfaces:** `scenario.flood_history` per the spec; events: UNOSAT `ST20161107…`, `ST20161201…`, `RS20171107_QuangNam…`, `ST1_20201013_FloodExtent_CentralPart`, `RCM1_20201017_FloodExtent_QuangNam`, `K5_20201020_FloodExtent_QuangNam`, `ST1_20201030_FloodExtent_QuangNam`, `S1_20221015_FloodExtent_VietNam`; EOS `EOS-RS_20250611_FPM_S1_Vietnam_DaNang_Floods_v0.9.tif` (value 1 polygonised, sieve 12). Downloads move from the scratchpad to `packages/atlas-data/data/cache/flood/` (git-ignored). For 2016 files keep only `Water_Stat` flood classes if that column separates flood from normal water; otherwise label them "mặt nước" not "ngập".

- [ ] **Step 1:** load script + printed km² per event (expect the in-box figures in the spec within ±5 %).
- [ ] **Step 2:** API route + tool with a test (`flood_history` for a xã returns event names and dates, provenance credits UNOSAT/EOS).
- [ ] **Step 3:** dock checklist + outline layer + legend credits.
- [ ] **Step 4:** rerun Task 8's script with step 5 of the demo.
- [ ] **Step 5: Commit** `feat: so sánh lũ lịch sử từ ảnh vệ tinh UNOSAT và EOS-RS`.
