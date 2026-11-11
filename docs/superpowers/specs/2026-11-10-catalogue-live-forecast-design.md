# Catalogue ↔ map, simulated live rainfall and flood forecast

Status: design approved section by section, 2026-11-10. Builds on `2026-11-09-geonode-data-platform-plan.md` and `2026-11-09-platform-shell-sso-design.md` (GeoNode 5, Dagster and Keycloak running), and on the P1–P4 work of `2026-10-19-map-upload-edit-rbac-design.md`.

## Why

The user wants three flows between the three services:

1. Upload GeoTIFF, Shapefile, HEC-RAS results and rainfall maps to the map store (GeoNode/MapStore), then use them on the interactive map.
2. Export a map edited in WebAtlas and publish it to the store.
3. Use orchestration (Dagster) to pull live data, combine it with the map, and produce a flood forecast.

Real KTTV feeds arrive over about six months and the HEC-RAS 2D model needs the on-prem server, so live data is **simulated by replaying historical records** and the forecast model is a **placeholder behind a real interface**.

## Decisions (user, 2026-11-10)

| # | Decision |
|---|---|
| C1 | The forecast model is **HEC-RAS 2D**, behind a placeholder until the on-prem server can run it. |
| C2 | HEC-RAS results arrive both as **raw `.hdf`** and as **exported GeoTIFF**; both are accepted. |
| C3 | Live data is **simulated by replaying historical data**. |
| C4 | Publishing to the store **needs review**. |
| C5 | Review is **one queue in WebAtlas over GeoNode moderation** (option C): every GeoNode upload starts unpublished; approval in WebAtlas publishes it in GeoNode. |
| C6 | Four sub-projects S1–S4 and the shared rules below (section 1 approved). |
| C7 | S1 as designed below (approved). |
| C8 | S2 as designed below (approved). |
| C9 | S3 is built around the **rainfall grid**, not stations (approved after the data was inspected). |
| C10 | The HEC-RAS model's terrain **is the WebAtlas DEM (FABDEM)**, so depth = water surface − FABDEM matches RAS Mapper's terrain. |
| C11 | The rainfall product is **GloH2O MSWEP** (daily, 0.1°). |
| C12 | The demo replays **the October 2025 event** (option A): MSWEP 2025 rainfall + the HEC-RAS 25–28/10/2025 run + the KTTV bulletin levels already collected. The 2026 rainfall stays available as a year-long replay. |

## Data on hand (inspected 2026-11-10)

Raw downloads stay outside the repository. They are ingested from a drop folder (`ATLAS_INBOX_DIR`, default `var/inbox`), never committed.

**MSWEP daily rainfall.** One NetCDF-4 file per day named `YYYYDDD.nc`; variable `precipitation` `(1, 1800, 3600)` float32 in mm/d, fill −9999, `lat` 89.95 → −89.95 and `lon` −179.95 → 179.95 (0.1° cell centres), `time` in days since 1900-01-01. Each value is a UTC day.
- 2025: days 217–365 (5/8–31/12/2025), 149 files, ~1.0 GB zipped.
- 2026: days 1–313 (to 9/11/2026), 313 files, ~2.2 GB zipped.
- Basin (14.9–16.2 °N, 107.2–108.8 °E, 13 × 16 cells) daily mean in the event: 25/10 68 mm, 26/10 195 mm, 27/10 201 mm, 28/10 166 mm, 29/10 186 mm; single cells up to 338 mm.

**HEC-RAS `thubon_vugia_10_25.p01.hdf`** (1.07 GB). HEC-RAS 7.0.1, SI units, WGS 84 / UTM 49N (EPSG:32649).
- One 2D flow area `Thu_Bon_Vu_Gia_4`: 410,610 real cells (412,983 rows including ghost cells), extent x 130,504–216,235 m, y 1,686,962–1,772,261 m.
- 289 output steps every 15 min, 25/10/2025 00:00 → 28/10/2025 00:00 (`Time Date Stamp`).
- Per step: `Water Surface` (cells), `Face Velocity` (faces), `Cell Cumulative Precipitation Depth`.
- Geometry: `Cells Center Coordinate`, `Cells FacePoint Indexes` + `FacePoints Coordinate` (cell polygons), `Cells Minimum Elevation`, boundary-condition lines (4 inflows: A Vương, Đăk Mi 4, Sông Bung 4, Sông Tranh 2; 8 downstream normal-depth lines).
- Rain input: hourly CHIRPS, 1 km grid (`Event Conditions/Meteorology`).
- Wet cells (depth above cell minimum > 5 cm): ~9,500 at the start, ~46,000 at the end.
- The terrain is not in the file (`.\Terrain\Terrain.hdf`); per C10 it is FABDEM.

## 1. Shared rules

1. **One home per dataset.** GeoNode is the catalogue, GeoServer serves, PostGIS or COG files hold the data. WebAtlas stores links, never copies, unless the user chooses "Sao vào Bản của tôi".
2. **Worker vs Dagster.** Jobs a user starts (upload, export, publish to the store) run on the P3b import worker. Scheduled and live work (replay, model runs, catalogue sync) runs in Dagster. Both use one Python library, `timeseries`, for building, registering and reading time series.
3. **A time series is one dataset.** A rainfall series, a HEC-RAS run or a forecast run is a stack of COGs served by GeoServer as one ImageMosaic layer with a `time` dimension and registered in GeoNode as one entry. On the map, every time-enabled layer is driven by one shared time slider (the time half of P10, pulled forward).
4. **Review state lives in GeoNode.** GeoNode moderation is on (`RESOURCE_PUBLISHING`, `ADMIN_MODERATE_UPLOADS`), so every new resource starts unpublished. WebAtlas keeps one link record per resource; from S2 on its managing unit decides who may approve.
5. **Every resource has a managing unit**, defaulting to the smallest unit wholly containing its extent (the P1 rule); the submitter may change it.
6. **Simulated means labelled.** The replayed feed and the placeholder forecasts carry the sample-data marking used since the flood demo.

## 2. S1 — catalogue → map

### What a user can do

1. Open **Thêm dữ liệu → Từ Danh mục**, search the GeoNode catalogue and add a dataset as a layer.
2. Play time-series layers on the time slider and hover to read the value at a point and time.
3. Upload a time series from the map's upload dialog. It lands in GeoNode as the user's own unpublished entry and is usable at once.
4. Copy a vector or single raster dataset into Bản của tôi to edit it or use it in analysis.

### GeoNode

- Moderation settings on (rule 4). No GeoNode group managers are created, so only GeoNode superusers can publish outside the queue.
- **Registration from code.** How to register a GeoServer layer (an ImageMosaic) as a GeoNode dataset from code is settled in the first task: GeoNode 5's API, the `updatelayers` management command, or a small helper next to GeoNode. The M1 basemap step of the platform plan needs the same answer. The task also confirms that GeoNode records the time dimension and that MapStore plays it.

### API module `catalogue`

- **Table `catalogue.resources`**: GeoNode pk and uuid, kind (`vector`, `raster`, `timeseries`), title, owner (WebAtlas user via the Keycloak subject), managing unit, review state, time extent, bbox, origin (`geonode-upload`, `webatlas-upload`, `pipeline`, `map-publish`), last synced.
- **Sync**: a Dagster job every minute pages GeoNode's resource API (service account), upserts link records, and fills the managing unit for new ones with rule 5.
- **Search** `GET /api/catalogue/search?q&kind&bbox&page`: published entries plus the caller's own unpublished ones, marked "Chưa duyệt". From S2, reviewers also see the unpublished entries they may approve.
- **Map-image proxy** `GET /api/catalogue/:id/wms?…`: checks visibility, then forwards GetMap, GetLegendGraphic and GetFeatureInfo to GeoServer with a service account, passing `TIME` through. Unpublished data never reaches GeoServer's public endpoint. Rate limit like the tiles route.

### Time-series import (new worker job `timeseries_import`)

- **GeoTIFF series**: a zip or several files; each step's time comes from a filename pattern the user confirms (default patterns cover `YYYYMMDD`, `YYYYMMDDHHmm`, `YYYYDDD`) or from a CSV `file,time`.
- **NetCDF series** (MSWEP layout and similar CF grids): one step per time value; clipped to a chosen extent.
- **HEC-RAS `.hdf`**:
  1. Read projection, cells, cell polygons, time stamps and `Water Surface` for the chosen 2D area.
  2. Rasterise each cell polygon with its water-surface elevation onto the FABDEM grid (30 m) over the 2D area's extent; depth = WSE − FABDEM; depth ≤ 0.05 m is no-data.
  3. Default output is hourly (73 steps for this run); 15-minute output is an option. Also writes the peak-depth raster.
  4. Labelled "nội suy từ .hdf trên FABDEM". Exported RAS Mapper GeoTIFFs, when present, are the exact alternative and go through the GeoTIFF path.
- **Output**: one COG per step in EPSG:3857 (matching P3b), an ImageMosaic store with a PostGIS granule index carrying `time`, a style per variable (depth reuses the flood demo's ramp; rainfall gets a sequential ramp), registration in GeoNode as the uploader's unpublished entry, and a link record.
- The original upload is kept, as P3b does.

### Map

- Catalogue layers in the layer tree with legend, opacity and remove.
- **Shared time slider**: shown while any visible layer has a time dimension; its range is the union of their extents; each layer shows the latest step at or before the slider time. Play, step and speed controls.
- **Hover value** on time-series layers through GetFeatureInfo at the slider time.
- **Personal maps can hold catalogue links** as a layer kind, so they save and share like other personal layers. A link to an entry the viewer cannot see shows as "không có quyền xem".
- **Sao vào Bản của tôi** for vector (WFS → GeoPackage → P3b import) and single rasters (COG copy).

### Not in S1

- Copying time series into Bản của tôi (link only).
- Moving the flood dock onto the shared slider.
- Any publishing (S2).

## 3. S2 — publishing to the store, reviewed (after P4)

### A third submission target

P4 submissions target one of the 8 layers or a catalogue map. S2 adds **catalogue resource** (a link record and its GeoNode entry). Same lifecycle (Cá nhân → Đã nộp → Đã xuất bản, or Trả lại with a reason), same `app.submission_events`, same "Xuất bản ngay" for someone who already holds `submission.review` on the managing unit (U16).

### Three ways in

1. **Uploaded in GeoNode, or a time series uploaded from the map.** The entry sits in **Bản của tôi → Trên Danh mục – chưa duyệt** and in the picker, each with **Nộp**. Nothing is reviewed until the owner presses Nộp.
2. **"Xuất bản lên Danh mục" on a personal map.** A worker job exports each layer (GeoPackage for vectors, COG for rasters), uploads them to GeoNode as unpublished datasets owned by the user, creates **one GeoNode map** grouping them in the same order, pre-fills metadata from the map's lineage and the data dictionary (title, description, managing unit, CRS, source), and opens **one** submission. Styles carry over simplified (each layer's colour and symbol).
3. **Republishing a map already in the store.** The new data goes into a hidden staging entry; the published entry keeps showing until approval, which replaces its data and removes the staging entry.

### Review (Quản lý → Hàng chờ duyệt)

- Reviewers: holders of `submission.review` on the managing unit.
- The reviewer sees the data on the shared map through the proxy, the metadata, and for a republish an old/new toggle.
- **Xuất bản** publishes in GeoNode with the service account. **Trả lại** needs a reason; the entry stays unpublished; the owner is notified, fixes the metadata in GeoNode ("Sửa trên Danh mục") or uploads again, and presses Nộp again.

### Official layers

Never copied (rule 1). When P4 publishes a new version of an official layer that is registered in GeoNode, S2 refreshes that record's metadata (last update, version label). Registering the official layers belongs to the platform plan (M1/M2).

### Closing the gap

If the sync job finds an entry published without an approval, it writes an audit entry "xuất bản ngoài hàng chờ" and flags it in the queue.

## 4. S3 — simulated live rainfall

### Preparation (Dagster, once per source folder)

- Clip every MSWEP file to the area of interest (basin bounding box plus a 0.2° margin) and write one COG per day (EPSG:4326 at the native 0.1°; GeoServer reprojects). Uses the `timeseries` library.
- Two replay sources are prepared: **2025** (5/8–31/12/2025) and **2026** (1/1–9/11/2026).

### Data model

- **`obs.observations`**: series key, variable (`rain_daily`, later `water_level`, `discharge`), time, value, quality flag, source (`replay-mswep`, later `kttv`), received at. Indexed for time-range reads.
- **Series** are the basin mean, and later stations from `water.stations` matched by station code; unknown codes go to an admin list instead of being dropped.
- **Alarm levels** BĐ1–BĐ3 per station with their source; only bulletin-confirmed values are shown as official.

### Replay

- **One source interface**: `ReplayMswepSource` now, `KttvApiSource` later. Moving to real data changes the source only.
- **Simulation clock**: one record (replay source, simulated time, speed, running/paused). A Dagster job every minute releases everything whose time has passed on the simulated clock: that day's grid joins the **"Mưa ngày – mô phỏng thời gian thực"** time layer (its extent grows), and the basin mean plus 1-, 3- and 7-day totals go into `obs.observations`.
- **Original dates are kept**, not shifted to today; the banner reads *"Mô phỏng thời gian thực – dữ liệu mưa lịch sử MSWEP (GloH2O), tốc độ …"*.
- **Controls** on **Quản lý → Mô phỏng**: choose source, start, pause, speed (simulated time per real minute: 1 h, 6 h, 1 day), jump to a time, reset. Reset clears the replayed rows and layer steps of that replay only.

### On the map

- A basin rainfall panel: daily bars and the running total, up to the simulated time.
- **"Biểu đồ mưa tại điểm"**: click anywhere; the API reads that cell's series up to the simulated time.
- The map polls `GET /api/observations/latest` and the clock once a minute.

## 5. S4 — flood forecast (placeholder)

### Model interface (Dagster)

`run(issue_time, inputs) → forecast run`

- **Inputs**: rainfall from the replay (and later upstream inflows), the DEM.
- **Outputs**: depth per time step, peak depth, water levels at forecast points: Ái Nghĩa, Câu Lâu and Hội An (each checked to lie inside the 2D area), plus any point clicked on the map.
- **Table `forecast.runs`**: model and version, issue time, horizon, inputs and their lineage, outputs, status. Each run is published as a catalogue time-series entry by the pipeline, marked as sample data.
- **Real adapter later**: writes the rain grid and boundary conditions, runs HEC-RAS on the on-prem server, reads the `.hdf` with the S1 reader. Nothing downstream changes.

### Placeholder: a library of pre-computed HEC-RAS runs

- Each library entry is a HEC-RAS result already converted by S1, with its event window and rain total.
- When the simulated clock reaches an entry's issue time (default: its first step, 25/10/2025 00:00 for the current run), the placeholder issues it: the steps after the issue time become the forecast run.
- The library starts with `thubon_vugia_10_25.p01` and grows with every HEC-RAS result uploaded through S1.

### On the map

- **"Dự báo ngập"** on the shared time slider, with "phát hành lúc …".
- Forecast-point charts: forecast and observed water level with BĐ1–BĐ3 lines. Observed levels are the bulletin readings at **Ái Nghĩa and Câu Lâu** collected for the flood demo (`packages/atlas-data/tools/flood_scenario`, `flood-2025-10-levels.csv`), loaded into `obs.observations` with source `bulletin`. The demo *derived* Hội An's series, so Hội An shows the forecast only.
- **Scoring** after the event: KGE and peak error at Ái Nghĩa and Câu Lâu (thuyết minh section 22). With a few bulletin readings per day the score is indicative, and is labelled so.

### The demo

Replay source 2025, clock from 20/10/2025: rain builds up on the daily layer and the basin chart; at 25/10 00:00 the forecast is issued; the slider plays the forecast flood; as the clock passes the observed bulletin times the charts fill with observed levels; at the end the scores show.

## 6. Order and dependencies

| Order | Sub-project | Needs |
|---|---|---|
| 1 | S1 catalogue → map | Platform stack on this branch |
| 2 | S3 simulated live rainfall | S1 (`timeseries` library, time layers) |
| 3 | S4 forecast placeholder | S1, S3 |
| 4 | S2 publishing, reviewed | P4 |

S1, S3 and S4 do not depend on P4. Where they sit against P4 and the mid-December seminar (whose theme is upload and edit) is the user's call.

Each sub-project gets its own plan.

## Testing

- **Python** (`timeseries` library, worker, Dagster): the `.hdf` reader against a generated file with the same group layout, plus an opt-in test against the real file (`RAS_HDF_SAMPLE`); MSWEP clip against a generated NetCDF; clock behaviour (speed, pause, jump, reset, no duplicates); the placeholder's issue logic.
- **API**: catalogue search visibility, proxy access checks, observations endpoints, submissions of the new target (S2), with GeoNode mocked; one opt-in end-to-end test against the real GeoNode.
- **Browser scripts**: S1 search → add → play → hover; S3 start a replay and watch the layer and chart grow; S4 the demo sequence above; S2 both ways in.

## Out of scope

- Running HEC-RAS (needs the on-prem server).
- Real KTTV ingestion (source interface only).
- Alerts and notifications on thresholds.
- Road and residential impacts of the forecast (the flood demo's impact analysis is not re-wired here).
- Full style fidelity when publishing maps to the store.

## Assumptions awaiting confirmation

1. **Pipeline outputs** (replayed rain layers, forecast runs) are published by the system without going through the review queue; C4 applies to what people publish.
2. Time-series entries are **link-only** on the map.
3. HEC-RAS conversion defaults: **30 m on the FABDEM grid, hourly steps, 5 cm wet threshold**.
4. The MSWEP clip area is the **basin bounding box plus 0.2°**.
5. Unpublished entries are visible to their **owner and to reviewers** who may approve them, nobody else.
6. **MSWEP licence**: GloH2O offers MSWEP free for non-commercial use; whether a government deployment fits needs checking before production.
7. BĐ1 values and the Giao Thủy level that came from memory in the flood demo are **not shown as official**; Hội An's derived series is not shown as observed.
