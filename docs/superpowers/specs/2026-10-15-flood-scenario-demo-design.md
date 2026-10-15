# Flood scenario demo: rain scenario → flood forecast → impacts → evacuation plan

**Status:** design agreed in brainstorming, 2026-10-15. Awaiting the user's review of this document.
**Deadline:** demo on 2026-10-16 at 10:00.
**Track:** a demo slice. It runs ahead of the extraction pipeline (parked, see the brainstorm notes doc) and ahead of redesign sub-project 6 (period picker); neither depends on it.

## Why

The demo has to show the whole decision chain the thuyết minh promises for floods: a rain forecast (from KTTV, or a preset) drives a flood forecast, the flood is played over time, and the assistant answers "kịch bản sơ tán?" by running the scenario, naming the roads and residential areas hit and when, and recommending an evacuation plan.

The system has no forecast data, no hydrological model and no flood rasters. Every scenario here is **mock data, marked as sample on every surface** (redesign D7). Roads, buildings, xã boundaries, gathering points and terrain are real (OSM extract `vietnam-261001`, `wards-region`, FABDEM); only the rain, the river levels and so the flood are invented.

## Decisions (user, 2026-10-15)

| # | Decision |
|---|---|
| F1 | The assistant recommends an **evacuation plan** (sơ tán): which xã go first and by when, which roads stay open, where to gather. |
| F2 | Area: the **Vu Gia – Thu Bồn lowland** (Đại Lộc, Điện Bàn, Duy Xuyên, Hội An; now in Đà Nẵng). |
| F3 | The flood is **computed from the real DEM**, not hand-drawn. |
| F4 | Scenario kinds: a **mock KTTV bulletin, presets, and a historical analogue**. |
| F5 | Approach A: **scenarios are computed offline and stored in PostGIS**; the demo makes no heavy calls. |
| F6 | The demo is at 10:00, so **road routing is cut**: the plan draws a straight arrow from each xã to its gathering point and lists roads still open. Real routing is a stretch goal only. |

## Scope of the area

Bounding box 107.95–108.40 °E, 15.70–15.98 °N (about 48 × 31 km). FABDEM at 1 arc-second gives roughly 1,620 × 1,010 cells.

## Scenarios

All five start at **06:00 on 16/10/2026** (the demo day, read as the bulletin issue time) and run **72 hours in 1-hour steps** (hours 0–72, 73 frames).

| id | Name | Kind | Rain over 72 h |
|---|---|---|---|
| `kttv-1610` | Bản tin dự báo mưa lớn (mô phỏng KTTV), phát hành 06:00 16/10 | kttv | 450 mm, peak intensity hour 20–30 |
| `preset-200` | Mưa 200 mm / 72 giờ | preset | 200 mm |
| `preset-400` | Mưa 400 mm / 72 giờ | preset | 400 mm |
| `preset-600` | Mưa 600 mm / 72 giờ | preset | 600 mm |
| `analog-1999` | Tương tự lũ lịch sử tháng 11/1999 | analogue | 900 mm, two pulses |

Every name shown on screen carries "(dữ liệu mẫu)" or sits under a "Dữ liệu mẫu" mark.

### Stations

Four mock stations at the real KTTV locations. Alarm levels are **approximate, entered from memory, and marked as sample**; they are not to be quoted as official.

| id | Station | River | BĐ1 / BĐ2 / BĐ3 (m) |
|---|---|---|---|
| `ai-nghia` | Ái Nghĩa | Vu Gia | 6.5 / 8.0 / 9.0 |
| `giao-thuy` | Giao Thủy | Thu Bồn | 6.0 / 7.5 / 8.5 |
| `cau-lau` | Câu Lâu | Thu Bồn | 2.0 / 3.0 / 4.0 |
| `hoi-an` | Hội An | Thu Bồn | 1.0 / 1.5 / 2.0 |

### Rain → river level

Hourly rain is the total spread over a fixed storm shape per scenario (a gamma-shaped pulse; two pulses for `analog-1999`). Each station's level is its base level plus the rain convolved with a gamma unit response (lag grows downstream: Ái Nghĩa ~6 h, Hội An ~12 h), scaled so that peaks land at:

| Scenario | Ái Nghĩa peak | Câu Lâu peak | Hội An peak |
|---|---|---|---|
| 200 mm | ≈ BĐ2 | ≈ BĐ2 | ≈ BĐ1–2 |
| 400 mm / KTTV | ≈ BĐ3 | ≈ BĐ3 | ≈ BĐ3 |
| 600 mm | BĐ3 + 1 m | BĐ3 + 1 m | BĐ3 + 0.7 m |
| 1999 analogue | BĐ3 + 1.8 m | BĐ3 + 1.5 m | BĐ3 + 1.2 m |

The generator is a pure function (scenario parameters → series) so it is unit-tested.

### Flood depth

For each hour:

1. A water-surface elevation is interpolated across the plain from the four station levels (inverse-distance weighting), so the surface falls from Ái Nghĩa/Giao Thủy towards Hội An.
2. Depth = surface − FABDEM ground; cells with depth ≤ 0 are dry.
3. Only wet cells **connected to a river channel** are kept (flood fill seeded from OSM `river`/`riverbank` waterways and water areas inside the box). This stops closed hollows far from the river from flooding.
4. Depths are classed: 1 = under 0.5 m, 2 = 0.5–1 m, 3 = 1–2 m, 4 = over 2 m; polygonised per class, simplified at 30 m, stored per hour.

Two rasters per scenario feed the exposure step: `first_hour` (first hour a cell is wet, null if never) and `max_depth`.

This is a planar-surface ("bathtub") approximation. It is honest about its kind: the dock and the assistant call it "mô phỏng nhanh dựa trên địa hình", never a hydraulic model.

### Exposure

- **Roads:** OSM roads in the box with `fclass` in motorway, trunk, primary, secondary, tertiary, unclassified, residential and their `_link` forms. Each segment is sampled every 30 m; it is **cut** at the first hour any sample is ≥ 0.3 m deep. Stored: first cut hour (null if never), max depth.
- **Buildings:** OSM building polygons in the box; each centroid gets `first_hour` and `max_depth`, wet meaning ≥ 0.2 m.
- **Xã/phường:** buildings are grouped by `wards-region`. Per xã and scenario: buildings total, buildings flooded, **people estimated at 4 per flooded building** (labelled "ước tính"), `first_hour` = first hour at which 5 % of its buildings are wet, `deadline_hour` = `first_hour − 3` (floored at 0), max depth.
- **Gathering points:** OSM POIs (point and area) with `fclass` in school, college, university, community_centre, town_hall, kindergarten, whose `max_depth` is 0 under `analog-1999` (the worst case). Capacity is unknown and not shown.

### Evacuation plan (per scenario)

For every xã with flooded buildings:

- **Priority** by `deadline_hour` ascending, then people descending.
- **Gathering point:** the nearest dry one (straight-line), with distance.
- **Open roads:** the named roads inside the xã whose cut hour is later than its deadline (or never), up to five, so the plan can say "đi theo ĐT609 trước 14:00".
- **Arrow:** a straight line from the xã's flooded-building centroid to the gathering point. The UI and assistant call it "hướng sơ tán", not a route.

Stretch (only if time is left after the demo path works end to end): shortest road path with `networkx`, skipping roads cut before the deadline.

## Storage

A standalone script owns a `scenario` schema and rebuilds it whole on each run (drop and recreate): this is sample data with no versions to keep. The `atlas-tools` image gains `networkx` only if the stretch is attempted.

| Table | Columns |
|---|---|
| `scenario.flood_scenario` | id, name, kind, rain_total_mm, start_time, hours, description, is_sample |
| `scenario.flood_station` | id, name, river, bd1, bd2, bd3, geom (Point) |
| `scenario.flood_series` | scenario_id, station_id, hour, rain_mm, level_m |
| `scenario.flood_frame` | scenario_id, hour, depth_class, geom (MultiPolygon) |
| `scenario.flood_road` | scenario_id, osm_id, name, ref, fclass, cut_hour, max_depth, geom |
| `scenario.flood_ward` | scenario_id, ward_code, ward_name, buildings_total, buildings_flooded, people_est, first_hour, deadline_hour, max_depth, centroid |
| `scenario.shelter` | id, name, kind, geom |
| `scenario.flood_plan` | scenario_id, ward_code, priority, shelter_id, distance_m, open_roads (text[]), arrow (LineString) |

All geometry is EPSG:4326 like every other layer. Script: `packages/atlas-data/tools/flood_scenario/build_scenarios.py`, run in the `atlas-tools` container; it reads the DEM from `basemap.dem_region` and OSM layers from the cached Geofabrik zip.

## API — `apps/api/src/modules/scenarios`

Read-only, open to anyone who can see the map.

| Route | Returns |
|---|---|
| `GET /scenarios` | the five scenarios with start time, hours and `isSample` |
| `GET /scenarios/:id` | the scenario, stations with BĐ levels, and hourly series |
| `GET /scenarios/:id/frames` | GeoJSON FeatureCollection of all frames (`hour`, `depthClass`), fetched once per scenario |
| `GET /scenarios/:id/impacts?hour=h` | roads cut by hour h, xã wet by hour h with first hour and people, totals |
| `GET /scenarios/:id/plan` | the evacuation plan rows with shelters and arrows |

An unknown id → 404 with a Vietnamese message; an empty `scenario` schema → `200` with an empty list from `GET /scenarios`, which the dock shows as "Chưa có dữ liệu kịch bản".

## Map — Kịch bản lũ dock

A dock along the bottom of the map, opened from the tool group (a new "Kịch bản lũ" tool) or by the assistant.

- Scenario picker; the "Dữ liệu mẫu" mark beside it.
- Chart: hourly rain bars and the level at the chosen station (picker of four), with BĐ1–3 as dashed lines. Hand-drawn SVG; no new chart library.
- Play/pause, speed (1×, 2×, 4× = 1, 2, 4 simulated hours per second), and a slider over hours 0–72 labelled with clock time ("T+18 giờ · 00:00 17/10").
- Map layers while the dock is open: depth classes as four blues; roads cut by the current hour in red, roads cut later in orange; wet xã outlined; when a plan is shown, gathering points and arrows numbered by priority.
- Legend rows for each of those.
- Closing the dock removes its layers.

All frames of the chosen scenario are fetched once; scrubbing and playing only switch which hour's features are drawn, so playback never waits on the network.

## Trợ lý

Four tools, appended to the end of the registry (order is the cached prefix):

| Tool | Does |
|---|---|
| `list_flood_scenarios` | names, kinds, rain totals |
| `run_flood_scenario(scenarioId, hour?)` | opens the dock on that scenario at `hour` (default: the hour of peak flooded area); returns peak levels vs BĐ per station, peak hour, flooded area by 6-hour step |
| `flood_impacts(scenarioId, hour)` | roads cut and xã wet **by that hour**, each with its first hour as clock time; totals of buildings and people |
| `evacuation_plan(scenarioId)` | the plan rows; draws gathering points and arrows and moves the slider to the earliest deadline |

Two map commands join `MapCommand`: `showFloodScenario { scenarioId, hour?, play? }` and `showEvacuationPlan { scenarioId }`, with `clearFloodScenario`.

Every tool records provenance "Kịch bản mô phỏng — dữ liệu mẫu" so the provenance chip marks the answer as sample.

System prompt gains a short section on evacuation advice: evacuate in order of deadline; finish before the deadline; use only roads still open at the deadline; prioritise the elderly, children and people in single-storey houses near the river; follow "4 tại chỗ"; say plainly that the scenario is a simulation on sample data.

For the demo, `ASSISTANT_MODEL` is set in the local `.env` to a Sonnet model; the default in code is unchanged.

## Demo script

1. Open the map, open Kịch bản lũ, pick `kttv-1610`, play.
2. Ask the assistant: "Theo bản tin KTTV sáng nay, đến 18 giờ ngày mai những tuyến đường nào bị ngập?"
3. Ask: "Kịch bản sơ tán cho kịch bản này?" → plan drawn, slider at the earliest deadline.
4. Switch to `preset-600` and ask the same; the plan grows.

## Failure handling

- No scenario data: dock empty state, tools answer "chưa có dữ liệu kịch bản".
- Frames fail to load: the dock shows the error with "Thử lại"; the slider is disabled.
- The assistant asks for an hour outside 0–72: the tool clamps and says so.

## Testing

- Python: unit tests for the rain/level generator and the depth classing on a tiny synthetic DEM.
- API: route tests against the dev DB after the script has run (skipped with a clear message when the schema is empty).
- Assistant: tool tests in the existing style (collected commands, provenance).
- Web: model tests for the playback state (play, pause, speed, clamp, scenario switch resets hour).
- Browser: one rehearsal of the demo script with screenshots, per the shell-architecture rule that layout is proven only in a browser.

## Out of scope

Real KTTV feeds; hydraulic modelling; shelter capacity; road routing (stretch only); the period picker of redesign sub-project 6; layouts below 768 px; printing a scenario.

## Assumptions not confirmed by the user

1. Scenario start time is 06:00 on the demo day.
2. The alarm levels in the stations table are approximate.
3. 4 people per building; 3 hours of lead time before the first flooding; 0.3 m cuts a road; 0.2 m wets a building.
4. The dock is reachable without sign-in; the assistant stays signed-in only, as today.
