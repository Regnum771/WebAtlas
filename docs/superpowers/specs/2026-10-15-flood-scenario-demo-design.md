# Flood scenario demo: rain scenario → flood forecast → impacts → evacuation plan

**Status:** design agreed in brainstorming, 2026-10-15; revised the same day to build on the real October 2025 flood. Awaiting the user's review of this document.
**Deadline:** demo on 2026-10-16 at 10:00.
**Track:** a demo slice. It runs ahead of the extraction pipeline (parked, see the brainstorm notes doc) and ahead of redesign sub-project 6 (period picker); neither depends on it.

## Why

The demo has to show the whole decision chain the thuyết minh promises for floods: a rain forecast (from KTTV, or a preset) drives a flood forecast, the flood is played over time, and the assistant answers "kịch bản sơ tán?" by running the scenario, naming the roads and residential areas hit and when, and recommending an evacuation plan.

The system has no forecast feed and no hydraulic model. Instead the demo **replays the record flood of 26–31/10/2025 on Vu Gia – Thu Bồn**: KTTV's real bulletin of 21:00 28/10/2025 stands in for "the forecast", and the river levels KTTV recorded afterwards drive the flood extent. Preset rain scenarios are scaled from that event. Roads, buildings, xã boundaries, gathering points and terrain are real (OSM extract `vietnam-261001`, `wards-region`, FABDEM). What is computed rather than observed (the flood extent, the scaled presets, levels at two derived stations) is labelled as such on every surface (redesign D7).

## Decisions (user, 2026-10-15)

| # | Decision |
|---|---|
| F1 | The assistant recommends an **evacuation plan** (sơ tán): which xã go first and by when, which roads stay open, where to gather. |
| F2 | Area: the **Vu Gia – Thu Bồn lowland** (Đại Lộc, Điện Bàn, Duy Xuyên, Hội An; now in Đà Nẵng). |
| F3 | The flood is **computed from the real DEM**, not hand-drawn. |
| F4 | Scenario kinds: a **KTTV forecast and presets**. |
| F5 | Approach A: **scenarios are computed offline and stored in PostGIS**; the demo makes no heavy calls. |
| F6 | The demo is at 10:00, so **road routing is cut**: the plan draws a straight arrow from each xã to its gathering point and lists roads still open. Real routing is a stretch goal only. |
| F7 | **Historical data approximates the forecast and the evacuation**: the October 2025 event is the basis of the demo; the invented 1999 analogue is dropped. |

## Scope of the area

Bounding box 107.95–108.40 °E, 15.70–15.98 °N (about 48 × 31 km). FABDEM at 1 arc-second gives about 1.8 million cells in it (checked 2026-10-15). 23 xã/phường of `wards-region` fall inside it, Đại Lộc and Vu Gia to Hội An Đông.

## Source data for the October 2025 event

KTTV national flood bulletins (`dbqg_lulu_*`, Trung tâm Dự báo KTTV quốc gia), 14 issues from 21:00 27/10 to 21:00 31/10/2025, downloaded from kttv.gov.vn. Readings taken from them:

| Time (2025) | Ái Nghĩa (m) | Câu Lâu (m) |
|---|---|---|
| 21:00 27/10 | 10.04 | 4.81 |
| 21:00 28/10 | (to extract) | 5.11 |
| 03:30 29/10 | (to extract) | 5.22 |
| 07:00 29/10 | 9.92 | 5.20 |
| 15:30 29/10 | (to extract) | 5.18 |
| 21:00 29/10 | (to extract) | 5.42–5.48 |
| ~02:00 30/10 | **10.22** | **5.62** (peak; above the 1964 record of 5.48) |
| 09:00 30/10 | 9.74 | 5.47 |
| 15:30 30/10 | (to extract) | 5.09 |
| 21:00 30/10 | 8.70 | 4.62 |
| 03:30 31/10 | (to extract) | 4.15 |
| 09:00 31/10 | 8.33 | 3.60 |
| 15:30 31/10 | 7.97 | 3.06 |
| 21:00 31/10 | 7.69 | 2.59 |

"To extract" values are in the same PDFs; the build step reads them from the PDF text (pypdf) and checks them by hand. The **forecast table of the 21:00 28/10 bulletin** (6-hour steps from 03:00 29/10): Ái Nghĩa 10.16, 10.20, 10.40, 10.40, 10.20; Câu Lâu 5.15, 5.20, 5.35, 5.35, 5.35.

Context for the assistant and for checking results: rain from the afternoon of 25/10 passed 1,000 mm in many places of Đà Nẵng (highest Trà Giáp 1,752.6 mm; Khâm Đức 453.4 mm in the 24 h to 10:00 29/10); the city reported more than 76,000 households flooded and 10 xã/phường cut off; each bulletin lists the xã at flood risk.

## Scenarios

| id | Name on screen | Basis | Hours |
|---|---|---|---|
| `kttv-2025-10` | Bản tin KTTV 21:00 28/10/2025 — tái hiện lũ 10/2025 | Recorded levels above, hourly by linear interpolation | 96 h from 21:00 27/10/2025 |
| `preset-500` | Mưa 500 mm (ước tính từ lũ 10/2025) | 2025 hydrograph scaled | same 96 h |
| `preset-1000` | Mưa 1.000 mm (≈ lũ 10/2025) | equal to `kttv-2025-10` | same |
| `preset-1300` | Mưa 1.300 mm (lớn hơn lũ 10/2025) | 2025 hydrograph scaled | same |

Presets keep the 2025 timing and scale each station's rise above its pre-event level (the 21:00 27/10 value minus 3 m at Ái Nghĩa, minus 2.5 m at Câu Lâu) by `(rain / 1000) ^ 0.6`. The exponent and the 1,000 mm event total are assumptions, stated in the dock ("ước tính").

**The bulletin moment.** The slider marks hour 24 (21:00 28/10) as "Bản tin dự báo". On the chart, KTTV's forecast points from that bulletin are drawn as dashed markers next to the recorded line, so the audience sees the forecast and what followed. The flood frames come from the recorded levels; the dock and the assistant say so: "ngập mô phỏng từ mực nước thực đo, dùng thay cho mực nước dự báo".

### Stations

| id | Station | River | BĐ1 / BĐ2 / BĐ3 (m) | Levels | Record |
|---|---|---|---|---|---|
| `ai-nghia` | Ái Nghĩa | Vu Gia | 6.5 / 8.0 / 9.0 | recorded | 10.77 m (2009) |
| `cau-lau` | Câu Lâu | Thu Bồn | 2.0 / 3.0 / 4.0 | recorded | 5.62 m (10/2025) |
| `hoi-an` | Hội An | Thu Bồn | 1.0 / 1.5 / 2.0 | derived from Câu Lâu | 3.40 m (1964) |
| `giao-thuy` | Giao Thủy | Thu Bồn | 6.0 / 7.5 / 8.5 | derived from Ái Nghĩa | — |

BĐ2 and BĐ3 at Ái Nghĩa, Câu Lâu and Hội An are confirmed by the bulletins' "trên BĐ3 …" figures; BĐ1 values and all of Giao Thủy are from memory and labelled approximate. Derived levels: Hội An = 2.0 + (Câu Lâu − 4.0) × 0.94 (fits BĐ3↔BĐ3 and the forecast 3.5 m at Hội An against 5.6 m at Câu Lâu); Giao Thủy = Ái Nghĩa − 0.5 m. Both are labelled "ước tính".

### Flood depth

For each hour:

1. A water-surface elevation is interpolated across the plain from the four station levels (inverse-distance weighting), so the surface falls from Ái Nghĩa/Giao Thủy towards Hội An.
2. Depth = surface − FABDEM ground; cells with depth ≤ 0 are dry.
3. Only wet cells **connected to a river channel** are kept (flood fill seeded from OSM `river`/`riverbank` waterways and water areas inside the box).
4. Depths are classed: 1 = under 0.5 m, 2 = 0.5–1 m, 3 = 1–2 m, 4 = over 2 m; polygonised per class, simplified at 30 m, stored per hour.

Two rasters per scenario feed the exposure step: `first_hour` and `max_depth`.

This is a planar-surface ("bathtub") approximation: the UI and the assistant call it "mô phỏng nhanh dựa trên địa hình và mực nước", never a hydraulic model.

**Checks against the record** (printed by the build script, not shown in the demo): the xã wet at the peak of `kttv-2025-10` against the xã listed at risk in the 21:00 28/10 bulletin; the peak flooded area against the UNOSAT satellite extents of past floods in the box (44–216 km² for 2016–2022 events). If the computed area is far outside that range, the surface or the connectivity seed is wrong and is fixed before the demo.

### Exposure

- **Roads:** OSM roads in the box with `fclass` in motorway, trunk, primary, secondary, tertiary, unclassified, residential and their `_link` forms. Each segment is sampled every 30 m; it is **cut** at the first hour any sample is ≥ 0.3 m deep. Stored: first cut hour (null if never), max depth.
- **Buildings:** OSM building polygons in the box; each centroid gets `first_hour` and `max_depth`, wet meaning ≥ 0.2 m.
- **Xã/phường:** buildings grouped by `wards-region`. Per xã and scenario: buildings total, buildings flooded, **people estimated at 4 per flooded building** ("ước tính"), `first_hour` = first hour at which 5 % of its buildings are wet, `deadline_hour` = `first_hour − 3` (floored at 0), max depth.
- **Gathering points:** OSM POIs (point and area) with `fclass` in school, college, university, community_centre, town_hall, kindergarten, dry under `preset-1300` (the worst case). Capacity is unknown and not shown.

### Evacuation plan (per scenario)

For every xã with flooded buildings:

- **Priority** by `deadline_hour` ascending, then people descending.
- **Gathering point:** the nearest dry one (straight-line), with distance.
- **Open roads:** the named roads inside the xã whose cut hour is later than its deadline (or never), up to five.
- **Arrow:** a straight line from the xã's flooded-building centroid to the gathering point, called "hướng sơ tán", not a route.

Because the event starts with the river already high (Ái Nghĩa above BĐ3 at hour 0), some xã are wet from hour 0. Their deadline is "đã ngập — sơ tán ngay / cứu hộ"; the plan lists them first.

Stretch only: shortest road path with `networkx`, skipping roads cut before the deadline.

### Past floods from satellite (lower priority — cut first if time is short)

Real flood extents clipped to the box, in `scenario.flood_history`:

| Event | Source, licence | In box |
|---|---|---|
| 07/11 and 01/12/2016 | UNOSAT, Sentinel-1, CC BY-SA | 97 and 124 km² of surface water |
| 07/11/2017 (Damrey) | UNOSAT, Radarsat, CC BY-SA | 216 km² |
| 13, 17, 20, 30/10/2020 | UNOSAT, Sentinel-1 / RCM / KOMPSAT-5, CC BY-SA | 56, 74, 68, 44 km² flood |
| 15/10/2022 | UNOSAT, Sentinel-1, CC BY-SA | 121 km² flood |
| 11/06/2025 (Wutip) | EOS-RS flood proxy map, Sentinel-1, CC BY | raster, polygonised |

The dock offers "So sánh lũ lịch sử" outlines; `flood_history` answers "xã/đường này từng ngập năm nào"; the plan notes per xã which past floods reached it. Credits go in the legend and provenance: "© UNOSAT (CC BY-SA)", "© EOS-RS, chứa dữ liệu Copernicus Sentinel-1 (CC BY)".

## Storage

A standalone script owns a `scenario` schema and rebuilds it whole on each run (drop and recreate). Raw downloads (KTTV PDFs, UNOSAT and EOS zips) go under `packages/atlas-data/data/cache/flood/`, which is git-ignored like the basemap cache; the extracted station readings are committed as a small CSV with the bulletin file named per row.

| Table | Columns |
|---|---|
| `scenario.flood_scenario` | id, name, kind (`kttv` / `preset`), rain_total_mm, start_time, hours, bulletin_hour, description, basis |
| `scenario.flood_station` | id, name, river, bd1, bd2, bd3, record_m, record_year, derived (bool), geom |
| `scenario.flood_series` | scenario_id, station_id, hour, level_m, forecast_m (null except the bulletin's points) |
| `scenario.flood_frame` | scenario_id, hour, depth_class, geom |
| `scenario.flood_road` | scenario_id, osm_id, name, ref, fclass, cut_hour, max_depth, geom |
| `scenario.flood_ward` | scenario_id, ward_code, ward_name, buildings_total, buildings_flooded, people_est, first_hour, deadline_hour, max_depth, centroid |
| `scenario.shelter` | id, name, kind, geom |
| `scenario.flood_plan` | scenario_id, ward_code, priority, shelter_id, distance_m, open_roads (text[]), arrow |
| `scenario.flood_history` | event_id, event_name, observed_on, source, sensor, licence, url, geom |

All geometry is EPSG:4326. Script: `packages/atlas-data/tools/flood_scenario/build_scenarios.py`, run in the `atlas-tools` container; it reads the DEM from `basemap.dem_region` and OSM layers from the cached Geofabrik zip.

## API — `apps/api/src/modules/scenarios`

Read-only, open to anyone who can see the map.

| Route | Returns |
|---|---|
| `GET /scenarios` | the scenarios with start time, hours, bulletin hour, basis |
| `GET /scenarios/:id` | the scenario, stations with BĐ levels and records, hourly levels and forecast points |
| `GET /scenarios/:id/frames` | GeoJSON FeatureCollection of all frames (`hour`, `depthClass`), fetched once per scenario |
| `GET /scenarios/:id/impacts?hour=h` | roads cut by hour h, xã wet by hour h with first hour and people, totals |
| `GET /scenarios/:id/plan` | the evacuation plan rows with shelters and arrows |
| `GET /flood-history` | past satellite extents with source and licence |

An unknown id → 404 with a Vietnamese message; an empty `scenario` schema → `GET /scenarios` returns an empty list, which the dock shows as "Chưa có dữ liệu kịch bản".

## Map — Kịch bản lũ dock

A dock along the bottom of the map, opened from the tool group (a new "Kịch bản lũ" tool) or by the assistant.

- Scenario picker; the basis line under it ("Mực nước thực đo KTTV" or "Ước tính từ lũ 10/2025").
- Chart: level at the chosen station (picker of four) with BĐ1–3 dashed, the station record dotted, and the bulletin's forecast points. Hand-drawn SVG; no new chart library.
- Play/pause, speed (1×, 2×, 4× = 1, 2, 4 simulated hours per second), and a slider over the scenario's hours labelled with clock time ("21:00 28/10/2025"), with the bulletin hour marked.
- Map layers while the dock is open: depth classes as four blues; roads cut by the current hour in red, roads cut later in orange; wet xã outlined; when a plan is shown, gathering points and arrows numbered by priority; past flood outlines when chosen.
- Legend rows for each of those, with credits.
- Closing the dock removes its layers.

All frames of the chosen scenario are fetched once; scrubbing and playing only switch which hour is drawn.

## Trợ lý

Five tools, appended to the end of the registry (order is the cached prefix):

| Tool | Does |
|---|---|
| `list_flood_scenarios` | names, basis, rain totals |
| `run_flood_scenario(scenarioId, hour?)` | opens the dock on that scenario at `hour` (default: the bulletin hour); returns peak levels vs BĐ and records per station, peak hour, flooded area by 6-hour step, and the bulletin's forecast vs what was recorded |
| `flood_impacts(scenarioId, hour)` | roads cut and xã wet **by that hour**, each with its first hour as clock time; totals of buildings and people |
| `evacuation_plan(scenarioId)` | the plan rows; draws gathering points and arrows and moves the slider to the earliest deadline |
| `flood_history(place)` | which past satellite-mapped floods reached an xã or a named road (only if the history part is built) |

Map commands added to `MapCommand`: `showFloodScenario { scenarioId, hour?, play? }`, `showEvacuationPlan { scenarioId }`, `clearFloodScenario`.

Provenance per tool: "Mực nước thực đo: Trung tâm Dự báo KTTV quốc gia; ngập: mô phỏng nhanh trên FABDEM" (or "ước tính" for presets).

System prompt gains a short section on evacuation advice: evacuate in order of deadline; xã already wet need rescue, not evacuation; finish before the deadline; use only roads still open at the deadline; prioritise the elderly, children and people in single-storey houses near the river; follow "4 tại chỗ"; say plainly what is recorded and what is simulated.

For the demo, `ASSISTANT_MODEL` is set in the local `.env` to a Sonnet model; the default in code is unchanged.

## Demo script

1. Open the map, open Kịch bản lũ on `kttv-2025-10`; the slider sits at the bulletin, 21:00 28/10/2025. Play.
2. Ask: "Theo bản tin KTTV 21 giờ ngày 28/10, đến 6 giờ sáng 30/10 những tuyến đường nào bị ngập?"
3. Ask: "Kịch bản sơ tán cho trận lũ này?" → plan drawn, slider at the earliest deadline.
4. Switch to `preset-1300` and ask the same; the plan grows.
5. If built: turn on "So sánh lũ lịch sử" 10/2020 and ask "Điện Bàn từng ngập những năm nào?"

## Failure handling

- No scenario data: dock empty state; tools answer "chưa có dữ liệu kịch bản".
- Frames fail to load: the dock shows the error with "Thử lại"; the slider is disabled.
- An hour outside the scenario: the tool clamps and says so.

## Testing

- Python: unit tests for the level interpolation, the preset scaling, the derived stations and the depth classing on a tiny synthetic DEM.
- API: route tests against the dev DB after the script has run (skipped with a clear message when the schema is empty).
- Assistant: tool tests in the existing style (collected commands, provenance).
- Web: model tests for playback (play, pause, speed, clamp, scenario switch resets the hour).
- Browser: one rehearsal of the demo script with screenshots.

## Out of scope

Live KTTV feeds; hydraulic modelling; shelter capacity; road routing (stretch only); the period picker of redesign sub-project 6; layouts below 768 px; printing a scenario.

## Assumptions not confirmed by the user

1. BĐ1 values and Giao Thủy's levels are from memory; derived station formulas as above.
2. Preset scaling `(rain / 1000) ^ 0.6` against a 1,000 mm event total.
3. 4 people per building; 3 hours of lead time; 0.3 m cuts a road; 0.2 m wets a building.
4. The dock is reachable without sign-in; the assistant stays signed-in only, as today.

## Sources

- KTTV bulletins: `https://kttv.gov.vn//upload/thuyvan{1,2}/2025/10/<day>/dbqg_lulu_202510<day>_<hhmm>.pdf`, 27–31/10/2025.
- UNOSAT flood extents on HDX: Quảng Nam 2016, 2017, 17/20/30-10-2020; central provinces 15/10/2022.
- EOS-RS flood proxy map, Đà Nẵng, 11/06/2025, on HDX.
- Rain totals and damage figures: daibieunhandan.vn, baovanhoa.vn, pctt.danang.gov.vn (October 2025 reporting).
