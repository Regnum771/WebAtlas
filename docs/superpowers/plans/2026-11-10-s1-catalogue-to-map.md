# S1 — Catalogue → map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can search the GeoNode catalogue from the map, add datasets as layers, play time-series layers (rainfall, HEC-RAS depth) on a shared time slider, upload a time series (GeoTIFF series, NetCDF, HEC-RAS `.hdf`) that lands in GeoNode as their own unpublished entry, copy vector or single-raster datasets into Bản của tôi, and keep catalogue links inside personal maps.

**Architecture:** A Python `timeseries` library (in the atlas-tools image) turns a series into COGs in a GeoServer ImageMosaic with a `time` dimension; a GeoNode-side Django app (`webatlas_bridge`) registers that mosaic as a GeoNode dataset owned by the uploader and lists resources for sync. The import worker gains a `timeseries_import` job; Dagster gains a one-minute catalogue sync into `catalogue.resources`; the API gets a `catalogue` module (search, map-image proxy, uploads, copy); the web gets a `catalogue` feature and a shared `time-slider` feature.

**Tech Stack:** Python 3 (rasterio 1.4.3, h5py 3.12.1, numpy, psycopg2, psycopg 3 in Dagster 1.13.27), GeoServer 2.28.5 ImageMosaic, GeoNode 5.0.3 (Django), Fastify + node-pg-migrate, React + OpenLayers, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-catalogue-live-forecast-design.md` (sections 1 and 2). Also read `docs/superpowers/specs/2026-11-09-platform-shell-sso-design.md` and `infra/platform/README.md` for the running stack.

## Global Constraints

- Code comments in English; UI strings, API user-facing messages and commit messages in Vietnamese (Conventional Commits), every commit ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run recursive deletes on this machine (`rm -rf`, `Remove-Item -Recurse`); remove test files one by one or leave them in the scratchpad.
- Python checks are `check()` scripts, no pytest (see `packages/atlas-data/tools/workspace/test_worker.py`); they run in the atlas-tools image: `docker compose -p webatlas -f infra/docker-compose.yml run --rm tools python3 <script>`. Tests that need live GeoServer/GeoNode are opt-in behind `GEONODE_E2E=1`.
- New pinned Python dependency: `h5py==3.12.1` in `packages/atlas-data/tools/requirements.txt` (reads both HEC-RAS `.hdf` and NetCDF-4). No netCDF4/xarray.
- Catalogue time series live in GeoServer workspace **`geonode`**, never `webatlas`: the `webatlas` workspace has a catch-all public ALLOW rule (`infra/platform/geoserver/webatlas-access.sh`), so an unpublished upload there would be public.
- COG steps: EPSG:3857, float32, nodata −9999, DEFLATE, internal overviews, nearest resampling (as `import_raster.py`). File name `<name>_<YYYYMMDDTHHMMSSZ>.tif`, times UTC.
- HEC-RAS conversion: 30 m grid in the 2D area's own CRS before warping, depth = WSE − FABDEM, depth ≤ 0.05 m → nodata, hourly by default (`every` = 4 for 15-min output), 15-min on request. Label `"nội suy từ .hdf trên FABDEM"`.
- Time-series files live under `TIMESERIES_DIR` (worker: `/repo/var/timeseries`; GeoServer sees the same folder as `/webatlas-timeseries`). Raw downloads are never committed.
- Time-series uploads: per-file cap **2 GiB**, extensions `.zip .tif .tiff .nc .hdf`, stored as `workspace.files` kind `upload` with `purpose = 'timeseries'`, **not counted** in `workspace.usage_bytes` (plan ruling R1).
- A time-series entry is link-only on the map: no "Sao vào Bản của tôi" for kind `timeseries`.
- Visibility of a catalogue resource: published → everyone (signed in or not); unpublished → its owner only (reviewers come with S2).

## Plan rulings (not in the spec; confirm at review)

- **R1** Time-series uploads go up to 2 GiB and do not count toward the personal 1 GiB quota (a 1.07 GB `.hdf` could never be uploaded otherwise).
- **R2** The worker writes the `catalogue.resources` row itself right after registering, so the uploader sees the entry at once; the Dagster sync keeps rows in step with GeoNode afterwards.
- **R3** ImageMosaic granule index in PostGIS (GeoNode's `geonode_data` database, one table per mosaic): a shapefile index loses the time of day because the stack runs GeoServer with `-Dorg.geotools.shapefile.datetime=false`.
- **R4** A `.hdf` with more than one 2D area imports the area named in the job params; with none named and several present, the job fails listing the area names.
- **R5** Copy into Bản của tôi reads vector data as GeoJSON over WFS and single rasters as GeoTIFF over WCS (admin credentials, server side), then queues the existing P3b `import` job.

## Review Focus

1. **Times that do not line up**: a series whose filenames do not match the chosen pattern, or two files mapping to the same time → the job fails naming up to five offending files; it never drops files silently. (Task 1 tests.)
2. **Slider before or between steps**: layers with different steps (daily rain, hourly depth) on one slider → each shows its latest step at or before the slider time, and *nothing* before its first step (not its first frame). (Task 11 tests.)
3. **Proxy smuggling**: a client sends `LAYERS` of another layer, `REQUEST=GetCapabilities`, a WFS request or a huge `WIDTH` → `LAYERS`/`QUERY_LAYERS` are forced to the resource's own layer, only GetMap/GetLegendGraphic/GetFeatureInfo pass, `WIDTH`/`HEIGHT` above 2048 are refused. (Task 9 tests.)
4. **An entry that disappears or becomes invisible** (deleted in GeoNode, or a personal map shared with someone who cannot see an unpublished link) → layer row shows "Không có quyền xem hoặc đã bị xoá", no endless spinner, no crash. (Tasks 10 and 12 tests.)
5. **HEC-RAS edge cases**: a geometry-only `.hdf` (no `Results/` group), cells outside FABDEM coverage → clear Vietnamese error for the first; nodata (not zero, not negative depth) for the second. (Task 3 tests.)

---

### Task 1: `timeseries` library core — times, COG steps, mosaic folder

**Files:**
- Create: `packages/atlas-data/tools/timeseries/__init__.py`, `model.py`, `times.py`, `cog.py`, `mosaic.py`, `geotiff_series.py`
- Create: `packages/atlas-data/tools/timeseries/test_core.py`
- Modify: `packages/atlas-data/tools/requirements.txt` (add `h5py==3.12.1`), `packages/atlas-data/tools/Dockerfile` only if the image copies a file list

**Interfaces:**
- Produces:
  - `model.Step(time: datetime, array: np.ndarray[float32], transform: Affine, crs: str)` — `time` tz-aware UTC; nodata in `array` is `np.nan`.
  - `model.SeriesMeta(name: str, title: str, variable: Literal['depth','rain','value'], unit: str, times: list[datetime], bounds4326: tuple[float,float,float,float], source_label: str)`.
  - `times.PATTERNS = {'YYYYMMDD', 'YYYYMMDDHHmm', 'YYYYDDD'}`; `times.parse_time(filename: str, pattern: str) -> datetime | None`; `times.times_from_csv(text: str) -> dict[str, datetime]`; `times.assign_times(names: list[str], pattern: str | None, csv: dict[str, datetime] | None) -> list[tuple[str, datetime]]` (sorted by time; raises `workspace_common.UserFacingError`).
  - `cog.step_filename(name: str, t: datetime) -> str`; `cog.write_step(step: Step, out_dir: str, name: str) -> str` (path written).
  - `mosaic.IndexDb(host, port, database, schema, user, password)`; `mosaic.write_config(out_dir: str, name: str, index: IndexDb) -> None` writes `indexer.properties`, `timeregex.properties`, `datastore.properties`.
  - `geotiff_series.read_series(files: list[tuple[str, datetime]]) -> Iterator[Step]`.

- [ ] **Step 1: Write the failing checks** in `test_core.py`:
  - `parse_time('rain_20251026.tif', 'YYYYMMDD') == datetime(2025,10,26,tzinfo=UTC)`; `parse_time('2025299.nc', 'YYYYDDD') == datetime(2025,10,26,tzinfo=UTC)`; `parse_time('d_202510260130.tif','YYYYMMDDHHmm') == datetime(2025,10,26,1,30,tzinfo=UTC)`; `parse_time('x.tif','YYYYMMDD') is None`.
  - `assign_times(['a_20251026.tif','b.tif'], 'YYYYMMDD', None)` raises `UserFacingError` whose message contains `b.tif`; two files with the same date raise naming both; with seven unmatched files the message names five and says `và 2 tệp khác`.
  - `times_from_csv('file,time\nx.tif,2025-10-26T01:00:00Z\n')['x.tif'] == datetime(2025,10,26,1,tzinfo=UTC)`.
  - `step_filename('lu_2025', datetime(2025,10,26,1,tzinfo=UTC)) == 'lu_2025_20251026T010000Z.tif'`.
  - `write_step` on a 20×20 float32 array in EPSG:32649 with a NaN block: output opens as a COG (`rasterio` profile `driver == 'GTiff'`, `is_tiled`, overviews ≥ 1), CRS EPSG:3857, nodata −9999, the NaN block reads back as −9999.
  - `write_config` output: `timeregex.properties` is exactly `regex=[0-9]{8}T[0-9]{6}Z,format=yyyyMMdd'T'HHmmss'Z'`; `indexer.properties` contains `TimeAttribute=time`, `Schema=*the_geom:Polygon,location:String,time:java.util.Date`, `PropertyCollectors=TimestampFileNameExtractorSPI[timeregex](time)`, `AbsolutePath=false`; `datastore.properties` contains `SPI=org.geotools.data.postgis.PostgisNGDataStoreFactory`, `schema=<schema>` and the given host/database/user.

- [ ] **Step 2: Run, expect FAIL** — `docker compose -p webatlas -f infra/docker-compose.yml run --rm tools python3 packages/atlas-data/tools/timeseries/test_core.py` → import errors.

- [ ] **Step 3: Implement** the modules. `assign_times` error text: `"Không xác định được thời điểm của: <names>"` and `"Trùng thời điểm <ISO>: <a>, <b>"`. `write_step` reuses `import_raster.target_grid`-style warping via `rasterio.warp.reproject` into an in-memory dataset then `rasterio.shutil.copy(..., driver='COG', COMPRESS='DEFLATE', RESAMPLING='NEAREST', OVERVIEW_COUNT=overview_count(...))`; write to `<path>.part` then `os.replace`.

- [ ] **Step 4: Run, expect all `ok`.** Rebuild the tools image first (`docker compose ... build tools`) for h5py.

- [ ] **Step 5: Commit** — `feat(atlas-data): thư viện chuỗi thời gian — thời điểm, COG từng bước, cấu hình ImageMosaic`.

### Task 2: NetCDF series reader (MSWEP layout), clipped

**Files:**
- Create: `packages/atlas-data/tools/timeseries/netcdf_series.py`, `test_netcdf.py`

**Interfaces:**
- Consumes: `model.Step`.
- Produces: `netcdf_series.read_cf(path: str, clip4326: tuple[float,float,float,float]) -> Iterator[Step]`; `netcdf_series.describe(path) -> dict(variable: str, unit: str, times: list[datetime])`.

- [ ] **Step 1: Write failing checks**: build with h5py a NetCDF-like file with the MSWEP layout (dims `lon`(3600) / `lat`(1800, 89.95 → −89.95) / `time`(1, units `days since 1900-1-1 00:00:00`, value 46320.0), variable `precipitation (1,1800,3600)` float32, `_FillValue` −9999, `units` `mm/d`) with a known value at lat 15.85, lon 108.05 (e.g. 201.0) and −9999 at a neighbour. Check: `describe()` → variable `precipitation`, unit `mm/d`, one time `2026-10-27T00:00Z` (46320 days after 1900-01-01); `read_cf(path, (107.2,14.9,108.8,16.2))` yields one step with shape `(13,16)`, top-left cell centre at (107.25, 16.15), value 201.0 at the expected cell, NaN at the fill cell, transform pixel size 0.1, CRS `EPSG:4326`. A file with no 3-D float variable raises `UserFacingError("Không tìm thấy biến lưới theo thời gian trong tệp NetCDF.")`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**: pick the first 3-D float variable whose dims end in lat/lon (`DIMENSION_LIST` names) — handle ascending or descending `lat`; slice only the clip window with h5py (never the whole globe); multiply nothing (units as stored).
- [ ] **Step 4: Run, expect `ok`; also run once against one real file** if `MSWEP_SAMPLE` is set (opt-in check: Oct 2025 day 2025300 basin mean between 190 and 210 mm).
- [ ] **Step 5: Commit** — `feat(atlas-data): đọc chuỗi lưới NetCDF (MSWEP) và cắt theo vùng`.

### Task 3: HEC-RAS `.hdf` → depth steps on FABDEM

**Files:**
- Create: `packages/atlas-data/tools/timeseries/hecras.py`, `dem.py`, `test_hecras.py`, `fixtures/make_ras_fixture.py`

**Interfaces:**
- Consumes: `model.Step`, `model.SeriesMeta`.
- Produces:
  - `hecras.RasFile(path)` context manager with `.areas: list[str]`, `.crs_wkt: str`, `.times: list[datetime]` (from `Results/Unsteady/Output/Output Blocks/Base Output/Unsteady Time Series/Time Date Stamp`, format `%d%b%Y %H:%M:%S`, taken as UTC), `.extent(area) -> (xmin, ymin, xmax, ymax)`.
  - `hecras.cell_index_grid(ras, area, transform, shape) -> np.ndarray[int32]` (−1 outside any cell).
  - `hecras.depth_steps(ras, area, dem: np.ndarray, transform, every: int = 4) -> Iterator[Step]` and `hecras.peak_depth(ras, area, dem, transform) -> Step` (time = last step's time).
  - `dem.read_dem(conn, bounds: tuple, crs_wkt: str, res: float = 30.0) -> tuple[np.ndarray, Affine]` — FABDEM from `basemap.dem_region` (as `flood_scenario/build_scenarios.py:read_dem`), warped bilinear onto a `res`-metre grid in `crs_wkt` covering `bounds`; outside coverage → NaN.

- [ ] **Step 1: Write the fixture builder** `make_ras_fixture.py` producing a tiny HDF with the real group layout: root attr `Projection` (UTM 49N WKT), `Geometry/2D Flow Areas/Attributes` (one row, Name `A1`), `Geometry/2D Flow Areas/Cell Info` `[[0, 4]]`, `Geometry/2D Flow Areas/A1/Cells Center Coordinate` (4 real + 1 ghost), `FacePoints Coordinate`, `Cells FacePoint Indexes` (−1 padded) describing a 2×2 grid of 100 m square cells, `Results/.../Time Date Stamp` (9 steps `25OCT2025 00:00:00` every 15 min), `Results/.../2D Flow Areas/A1/Water Surface` (9 × 5). A second builder variant omits `Results/`; a third has two areas.

- [ ] **Step 2: Write failing checks** in `test_hecras.py`:
  - `RasFile` on the fixture: `areas == ['A1']`, 9 times, first `2025-10-25T00:00Z`.
  - `cell_index_grid` at 50 m over the fixture extent: every pixel inside cell k has value k (0..3), pixels outside are −1, ghost cell index 4 never appears.
  - `depth_steps(every=4)` with a flat DEM of 10.0 and WSE 10.30 in cell 0, 10.03 in cell 1, 9.0 in cell 2: yields 3 steps (indexes 0, 4, 8); cell 0 pixels depth 0.30 (±1e-6), cell 1 NaN (≤ 0.05), cell 2 NaN (negative), pixels where DEM is NaN are NaN.
  - `peak_depth` equals the per-pixel max over all 9 steps.
  - Geometry-only file → `UserFacingError("Tệp .hdf không có kết quả mô phỏng (thiếu nhóm Results).")`; two-area file without a chosen area → `UserFacingError` containing both names.
  - Opt-in (`RAS_HDF_SAMPLE` set to the real file): `areas == ['Thu_Bon_Vu_Gia_4']`, 289 times from `2025-10-25T00:00Z` to `2025-10-28T00:00Z`, `crs` is UTM 49N.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement.** Algorithm for `cell_index_grid` (fixes the approach; the rest follows the signatures):
  ```python
  # cell polygons from FacePoint indexes (drop -1 padding), real cells only (Cell Info [0][1])
  shapes = ((Polygon(fp_xy[idx[idx >= 0]]), i) for i, idx in enumerate(cell_fp[:n_real]))
  grid = rasterio.features.rasterize(shapes, out_shape=shape, transform=transform, fill=-1, dtype='int32')
  ```
  Then per step: `wse = ws_dataset[i, :n_real]` (read one row, never the full array); `depth = np.where(grid >= 0, wse[grid.clip(0)] - dem, np.nan)`; `depth[depth <= 0.05] = np.nan`.
- [ ] **Step 5: Run, expect `ok`** (and the opt-in with the real file, reporting wet-pixel counts at steps 0, 144, 288 — expected to grow).
- [ ] **Step 6: Commit** — `feat(atlas-data): chuyển kết quả HEC-RAS .hdf thành độ sâu ngập trên FABDEM`.

### Task 4: GeoServer ImageMosaic publishing and styles

**Files:**
- Create: `packages/atlas-data/tools/timeseries/geoserver.py`, `styles/depth.sld`, `styles/rain.sld`, `test_geoserver_live.py`
- Modify: `infra/docker-compose.platform.yml` (geoserver: bind `../var/timeseries:/webatlas-timeseries`), `infra/docker-compose.yml` (worker env: `TIMESERIES_DIR=/repo/var/timeseries`, `GEOSERVER_TIMESERIES_DIR=/webatlas-timeseries`, `GEOSERVER_URL`, `GEOSERVER_ADMIN_USER`, `GEOSERVER_ADMIN_PASSWORD`, `TIMESERIES_INDEX_DB_*` from the `geonode_data` credentials)

**Interfaces:**
- Consumes: `mosaic.write_config`, the folder of COGs from Task 1.
- Produces: `geoserver.publish_mosaic(name: str, variable: str) -> str` (returns alternate `geonode:<name>`; idempotent); `geoserver.publish_coverage(name: str, gs_file: str, variable: str) -> str` (a single GeoTIFF store, for the peak-depth raster); `geoserver.delete_mosaic(name: str) -> None`; `geoserver.ensure_styles() -> None` (styles `webatlas_depth`, `webatlas_rain` in workspace `geonode`; variable `value` gets GeoServer's default raster style).

- [ ] **Step 1: Write the opt-in live check** (`GEONODE_E2E=1`): writes 3 hourly COG steps under `TIMESERIES_DIR/s1-e2e-<uuid>`, calls `publish_mosaic(..., 'depth')`, then asserts: coverage exists in workspace `geonode`; WMS GetCapabilities lists the layer with `<Dimension name="time"` containing the 3 ISO times; GetMap with `TIME=` the second step returns `image/png`; GetMap with a TIME before the first step returns a fully transparent image; `delete_mosaic` removes store and index table.
- [ ] **Step 2: Run with the platform stack up, expect FAIL.**
- [ ] **Step 3: Implement** with GeoServer REST: `PUT /rest/workspaces/geonode/coveragestores/<name>/external.imagemosaic` with body `file:///webatlas-timeseries/<name>`; then enable the time dimension on the coverage (`metadata.time = {enabled: true, presentation: 'LIST', units: 'ISO8601', defaultValue: {strategy: 'MINIMUM'}}`); set the default style by variable. Depth ramp copies `apps/web/src/features/flood-scenario/model/depthColour.ts` stops; rain ramp: 0 transparent, 1 `#c6dbef`, 10 `#6baed6`, 50 `#2171b5`, 100 `#08306b`, 200 `#54278f`, 300 `#3f007d`.
- [ ] **Step 4: Run, expect `ok`.**
- [ ] **Step 5: Commit** — `feat(atlas-data): xuất bản chuỗi thời gian lên GeoServer dạng ImageMosaic có chiều thời gian`.

### Task 5: GeoNode bridge — register datasets, list resources, moderation on

**Files:**
- Create: `infra/platform/geonode/webatlas_bridge/__init__.py`, `apps.py`, `urls.py`, `views.py`, `auth.py`
- Create: `packages/atlas-data/tools/timeseries/geonode_bridge.py`, `test_bridge_live.py`
- Modify: `infra/platform/geonode/webatlas_geonode_settings.py` (append `webatlas_bridge` to `INSTALLED_APPS`, `ROOT_URLCONF = 'webatlas_bridge.urls'`, `RESOURCE_PUBLISHING = True`, `ADMIN_MODERATE_UPLOADS = True`, `WEBATLAS_BRIDGE_TOKEN = os.environ['WEBATLAS_BRIDGE_TOKEN']`), `infra/docker-compose.platform.yml` (env `WEBATLAS_BRIDGE_TOKEN` in `x-geonode-env`; mount the app folder), `infra/.env.example`, `infra/platform/README.md`

**Interfaces:**
- Produces (HTTP, both behind `Authorization: Bearer $WEBATLAS_BRIDGE_TOKEN`, compared with `hmac.compare_digest`; 401 otherwise):
  - `POST /webatlas-bridge/datasets` body `{name, title, abstract, owner: {sub, username, email}}` → `201 {pk, uuid, alternate}`. Registers the existing GeoServer coverage `geonode:<name>` as a GeoNode dataset owned by the user whose Keycloak subject is `owner.sub` (creating the Django user and its `SocialAccount(provider=<oidc provider id>, uid=sub)` when missing), unpublished and unapproved, with the time dimension recorded.
  - `GET /webatlas-bridge/resources?since=<ISO>&page=<n>` → `{resources: [{pk, uuid, alternate, resourceType, subtype, title, abstract, ownerSub, isPublished, isApproved, bbox4326, lastUpdated}], next: n|null}`, 200 per page, ordered by `last_updated`.
  - Python client: `geonode_bridge.register_dataset(name, title, abstract, owner: dict) -> dict`; `geonode_bridge.list_resources(since: datetime | None) -> Iterator[dict]` (follows pages). Env `GEONODE_BRIDGE_URL` (in-network `http://django:8000`), `WEBATLAS_BRIDGE_TOKEN`.

- [ ] **Step 1: Spike the registration call** inside `django` (`docker compose ... exec django python manage.py shell`): try `geonode.geoserver.helpers.gs_slurp(owner=user, workspace='geonode', store=name, filter=name)` on a mosaic published by Task 4; if it does not register a coverage store with time, fall back to `geonode.resource.manager.resource_manager.create(...)` with `subtype='raster'`. Record which one works, and how GeoNode 5 stores the time dimension, in `infra/platform/README.md` under "Đăng ký dữ liệu từ mã". This step decides `views.py`'s body only; the HTTP contract above does not change.
- [ ] **Step 2: Write the opt-in live check** `test_bridge_live.py`: publishes a 3-step mosaic (Task 4), calls `register_dataset` with a fresh subject, then asserts: the response alternate is `geonode:<name>`; `list_resources(since=now-1min)` contains it with `ownerSub` = that subject, `isPublished` false; anonymous GeoNode API `/api/v2/datasets?filter{alternate}=geonode:<name>` returns 0 results (moderation hides it); a wrong token → 401. Cleans up via GeoNode API delete + `delete_mosaic`.
- [ ] **Step 3: Run, expect FAIL.** Implement. **Step 4: Run, expect `ok`.**
- [ ] **Step 5: Commit** — `feat(platform): cầu nối GeoNode — đăng ký bộ dữ liệu, liệt kê tài nguyên, bật kiểm duyệt`.

### Task 6: `catalogue` schema and the worker's `timeseries_import` job

**Files:**
- Create: `apps/api/src/db/migrations/1000000000036_catalogue.cjs`
- Create: `packages/atlas-data/tools/workspace/import_timeseries.py`, `test_import_timeseries.py`
- Modify: `packages/atlas-data/tools/workspace/worker.py` (`HANDLERS['timeseries_import']`), `infra/platform/postgis/platform-databases.sql` (grants for `webatlas_orchestrator`: `USAGE ON SCHEMA catalogue`, `SELECT, INSERT, UPDATE ON catalogue.resources`, `EXECUTE ON FUNCTION catalogue.unit_for_bbox`)

**Interfaces:**
- Produces (SQL):
  - `catalogue.resources`: `id uuid pk default gen_random_uuid()`, `geonode_pk integer unique not null`, `geonode_uuid uuid unique not null`, `alternate text not null`, `kind text not null check (kind in ('vector','raster','timeseries','map','document'))`, `title text not null`, `abstract text not null default ''`, `owner_sub text`, `managing_unit text not null` (same format check as P1), `is_published boolean not null`, `is_approved boolean not null`, `variable text`, `unit text`, `time_steps timestamptz[]`, `bbox4326 double precision[4]`, `origin text not null check (origin in ('geonode-upload','webatlas-upload','pipeline','map-publish'))`, `synced_at timestamptz`, `created_at`, `updated_at`. Indexes on `owner_sub`, `is_published`, trigram on `title`.
  - `catalogue.unit_for_bbox(w float8, s float8, e float8, n float8) RETURNS text` — `admin.managing_unit_for` over the provinces and wards intersecting the envelope (same SQL as `apps/api/src/modules/admin-units/repository.ts:suggestManagingUnit`).
  - `workspace.jobs.kind` check adds `'timeseries_import'`; `workspace.files` gains `purpose text not null default 'map' check (purpose in ('map','timeseries'))`; `workspace.usage_bytes` ignores `purpose = 'timeseries'`.
  - No grant of `catalogue` to `webatlas_assistant`.
- Produces (worker): job params `TimeseriesImportParams = {fileId, path, originalName, ownerId, owner: {sub, username, email}, title, abstract, source: 'geotiff'|'netcdf'|'hecras', timePattern: str|null, timesCsvPath: str|null, hdfArea: str|null, every: 1|4, clip4326: [w,s,e,n]|null}`; steps `read` "Đọc tệp", `transform` "Tạo các bước thời gian", `publish` "Đưa lên Danh mục"; result `{resourceId, alternate, steps}`.

- [ ] **Step 1: Write the migration** and run `npm run migrate:up -w @webatlas/api`; down migration restores the old checks and function.
- [ ] **Step 2: Write failing checks** `test_import_timeseries.py` (dev DB, own user as in `test_worker.py`). `import_timeseries` calls GeoServer and GeoNode only through two module attributes, `publish = geoserver.publish_mosaic` and `register = geonode_bridge.register_dataset` (plus `publish_single = geoserver.publish_coverage` for the peak raster), which the checks replace with recording fakes:
  - a zip of three GeoTIFFs named `r_20251025.tif`…`r_20251027.tif` → job succeeds; 3 COGs under `TIMESERIES_DIR/<name>/`; one `catalogue.resources` row with `kind 'timeseries'`, `origin 'webatlas-upload'`, `is_published false`, three `time_steps`, `managing_unit` = `catalogue.unit_for_bbox` of the extent, `variable 'value'`; `publish` called once with `(name, 'value')`, `register` with the owner dict.
  - the HEC-RAS fixture (Task 3) with `every=4` → 3 steps plus `<name>_peak.tif` beside (not in) the mosaic folder; `variable 'depth'`, `unit 'm'`, title suffix `(nội suy từ .hdf trên FABDEM)`; the peak raster is published with `publish_single` and registered as a second entry titled `<title> – độ sâu lớn nhất`, `kind 'raster'`, so two catalogue rows exist.
  - a NetCDF fixture (Task 2) with `clip4326` → `variable 'rain'`, `unit 'mm/d'`.
  - registration raising → job failed with `"Không đưa được lên Danh mục; thử lại sau."`, COG folder removed (`Steps.on_rollback`), no catalogue row.
  - `workspace.usage_bytes(owner)` unchanged by a `purpose='timeseries'` file.
- [ ] **Step 3: Run, expect FAIL.** Implement: `name` = `ts_<first 8 of fileId>`; source dispatch on extension (`.zip`/`.tif` → geotiff, `.nc`/zip of `.nc` → netcdf, `.hdf` → hecras); `variable` per source (geotiff `value`, netcdf `rain` when unit contains `mm`, hecras `depth`).
- [ ] **Step 4: Run, expect `ok`; run the existing `test_worker.py` too (unchanged behaviour).**
- [ ] **Step 5: Commit** — `feat(worker): công việc nhập chuỗi thời gian lên Danh mục; lược đồ catalogue`.

### Task 7: Dagster catalogue sync

**Files:**
- Create: `orchestration/webatlas_orchestration/catalogue_sync.py`, `orchestration/webatlas_orchestration/test_catalogue_sync.py`
- Modify: `orchestration/webatlas_orchestration/definitions.py` (job `dong_bo_danh_muc`, schedule every minute, default RUNNING), `orchestration/requirements.txt` (`requests==2.32.3`), `infra/docker-compose.platform.yml` (dagster env `GEONODE_BRIDGE_URL`, `WEBATLAS_BRIDGE_TOKEN`)

**Interfaces:**
- Consumes: `GET /webatlas-bridge/resources` (Task 5), `catalogue.unit_for_bbox` (Task 6).
- Produces: `catalogue_sync.kind_of(r: dict) -> str` (`resourceType 'dataset'` + `subtype 'vector'` → `vector`; `subtype 'raster'` → `raster`, or `timeseries` when a row already says so; `map`; `document`); `catalogue_sync.sync(conn, resources: Iterable[dict], now: datetime) -> SyncReport(inserted, updated, removed)`.

- [ ] **Step 1: Failing tests** (plain `check()` script, dev DB, rows with `geonode_pk` ≥ 900000 cleaned after): a new resource is inserted with `origin 'geonode-upload'` and a managing unit from its bbox; an existing row (`origin 'webatlas-upload'`, `kind 'timeseries'`) keeps its origin, kind, managing unit and `time_steps` while `title`, `is_published`, `is_approved` update; a row whose pk no longer appears in a *full* listing (`since=None`) is deleted; an incremental listing never deletes.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (incremental every minute with `since` = max `synced_at` − 2 min; full listing every 60th run). **Step 4: Run, expect `ok`.**
- [ ] **Step 5: Commit** — `feat(orchestration): đồng bộ Danh mục GeoNode vào catalogue.resources mỗi phút`.

### Task 8: API `catalogue` module — search, item, time-series upload

**Files:**
- Create: `apps/api/src/modules/catalogue/{routes,controller,repository,access,uploads,schemas}.ts`, `catalogue.test.ts`
- Modify: `apps/api/src/plugins/authentication.ts` (decorator `authenticateOptional`: verifies a Bearer token when present, leaves `currentUser` undefined when absent, 401 on a bad token), `apps/api/src/types/fastify.d.ts`, `apps/api/src/server.ts` (register under `/api/catalogue` in its own scope with multipart `fileSize: TIMESERIES_MAX_BYTES + 1`), `apps/api/src/modules/workspace/uploads.ts` (export the stream-to-store helper with `{maxBytes, extensions, purpose, countsToQuota}` options instead of duplicating it), `apps/api/src/modules/workspace/jobs.ts` (`JobKind` adds `'timeseries_import'`, `TIMESERIES_STEPS`)

**Interfaces:**
- Produces:
  - `CatalogueItem = {id, kind, title, abstract, managingUnit, isPublished, mine: boolean, variable: string|null, unit: string|null, timeSteps: string[]|null, bbox4326: [number,number,number,number]|null, layerName: string}` (`layerName` = `alternate`).
  - `GET /api/catalogue/search?q&kind&page` (optional auth) → `{items: CatalogueItem[], total, page, pageSize: 20}`; diacritic-insensitive `q` (use `fold_text` from migration 031); visibility per Global Constraints.
  - `GET /api/catalogue/:id` (optional auth) → `CatalogueItem`; invisible or missing → 404 `"Không tìm thấy dữ liệu trong Danh mục."`.
  - `POST /api/catalogue/uploads` (signed in, multipart, one file) → `{upload: {id, originalName, sizeBytes}}`; extensions and cap per Global Constraints; unsupported → 400 `"Định dạng chưa hỗ trợ cho chuỗi thời gian."`.
  - `POST /api/catalogue/timeseries` (signed in) body `{fileId, title, abstract?, timePattern?, timesCsvFileId?, hdfArea?, every?: 1|4}` → `202 {job}` (the workspace `Job` view); `owner` built from `app.users` (`oidc_subject`, email, full name). A user with no `oidc_subject` → 409 `"Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục."`.
  - `access.canView(user: CurrentUser | undefined, row) -> boolean`.

- [ ] **Step 1: Failing tests** (`catalogue.test.ts`, live DB, fixtures inserted straight into `catalogue.resources`): anonymous search sees published only; owner (matching `oidc_subject`) sees own unpublished with `mine: true`; another user does not; `q='lu'` matches title `Lũ tháng 10`; `GET /:id` of someone else's unpublished → 404; with the caps injected small (workspace 1 KiB, time series 2 KiB, through the services' `maxBytes` option) a 1.5 KiB `.hdf` stream is accepted by the catalogue upload and refused by the workspace upload; `.exe` → 400; `POST /timeseries` queues a `timeseries_import` job whose params include `owner.sub`; user without `oidc_subject` → 409; `usage_bytes` unchanged after a time-series upload.
- [ ] **Step 2: Run, expect FAIL** — `npm run test -w @webatlas/api -- catalogue`.
- [ ] **Step 3: Implement. Step 4: Run, expect PASS; run the workspace suites (`-- workspace`) to prove uploads unchanged.**
- [ ] **Step 5: Commit** — `feat(api): mô-đun catalogue — tìm kiếm, xem mục, tải chuỗi thời gian lên`.

### Task 9: API map-image proxy and "Sao vào Bản của tôi"

**Files:**
- Create: `apps/api/src/modules/catalogue/proxy.ts`, `copy.ts`, `proxy.test.ts`, `copy.test.ts`
- Modify: `apps/api/src/modules/catalogue/routes.ts`

**Interfaces:**
- Consumes: `canView`; the import-queueing function in `apps/api/src/modules/workspace/jobs.ts` that the `createImport` controller calls (same map-owner check, same `IMPORT_STEPS`); the stream-to-store helper exported in Task 8.
- Produces:
  - `GET /api/catalogue/:id/wms?<WMS params>` (optional auth; rate limit 6000/min like tiles). Allowed `REQUEST`: `GetMap`, `GetLegendGraphic`, `GetFeatureInfo` (case-insensitive); `LAYERS`, `QUERY_LAYERS`, `LAYER` forced to the item's `layerName`; passed through: `SERVICE, VERSION, BBOX, WIDTH, HEIGHT, SRS, CRS, FORMAT, TRANSPARENT, TIME, STYLES, I, J, X, Y, INFO_FORMAT, FEATURE_COUNT, TILED, LEGEND_OPTIONS`; others dropped; `WIDTH`/`HEIGHT` > 2048 → 400. Forwards to `${GEOSERVER_URL}/geonode/wms` (or the resource's workspace) with admin basic auth; streams the body and content type back; `Cache-Control: private, max-age=300` for unpublished, `public, max-age=300` for published.
  - `POST /api/catalogue/:id/copy` (signed in) body `{mapId}` → `202 {job}`; kind `vector` → WFS `GetFeature` `outputFormat=application/json` (cap 200 MB / `IMPORT_MAX_ROWS`), kind `raster` → WCS `GetCoverage` GeoTIFF; written as an upload owned by the caller, then an `import` job into `mapId`; kind `timeseries`/`map`/`document` → 400 `"Mục này chỉ thêm được dạng liên kết."`.

- [ ] **Step 1: Failing tests** with GeoServer mocked by an `undici` `MockAgent` (or a fake `fetch` injected into `proxy.ts`): forced LAYERS when the client sends another; `GetCapabilities` → 400; `WIDTH=4096` → 400; `TIME` passes through; anonymous on unpublished → 404; owner on unpublished → 200 with `private` cache header; copy of a vector queues an `import` job with an upload of the WFS body; copy of a timeseries → 400; copy into a map the caller does not own → the workspace 404.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(api): proxy ảnh bản đồ cho mục Danh mục và sao vào Bản của tôi`.

### Task 10: Web — "Từ Danh mục" picker, catalogue layers, time-series upload

**Files:**
- Create: `apps/web/src/features/catalogue/api/catalogue.api.ts`, `model/catalogue.store.ts`, `model/catalogueLayers.ts`, `model/useCataloguePickerPresenter.ts`, `model/useTimeseriesUploadPresenter.ts`, `ui/CataloguePicker.view.tsx`, `ui/CatalogueLayersSection.view.tsx`, `ui/TimeseriesUploadDialog.view.tsx`, `index.tsx`, tests beside each model/ui file
- Modify: `apps/web/src/features/add-data/index.tsx` (two tabs: "Từ Danh mục" first, "WMS khác" = current form), `apps/web/src/app/MapScreen.tsx` (mount `CatalogueLayersSection` above `LayersPanel`), `apps/web/src/styles/shell.css`

**Interfaces:**
- Consumes: Task 8/9 endpoints; `getAuthToken` from `shared/api/apiClient`.
- Produces:
  - `catalogue.store`: `CatalogueLayer = {item: CatalogueItem, visible: boolean, opacity: number, status: 'ok'|'gone'}`; `addCatalogueLayer(item)`, `removeCatalogueLayer(id)`, `setCatalogueLayer(id, patch)`, `getCatalogue()`, `useCatalogueStore()` (module store like `myMaps.store.ts`).
  - `catalogueLayers.syncCatalogueLayers(map: Map, layers: CatalogueLayer[], time: string | null): void` — one `ol/layer/Image` + `ImageWMS` per layer pointing at `/api/catalogue/:id/wms`, `imageLoadFunction` fetching with the Bearer token when signed in (blob URL, revoked after load), z-index `700 + order` (below personal layers' 800), `TIME` param from `time` for time-series layers (none for others).
  - `CATALOGUE_Z_BASE = 700`.

- [ ] **Step 1: Failing tests**: picker shows "Chưa duyệt" badge on `mine && !isPublished`; empty result text `"Không có dữ liệu phù hợp."`; API error shows `"Không kết nối được Danh mục."` and the WMS tab still works; adding the same item twice keeps one layer; `syncCatalogueLayers` sets `TIME` only on time-series layers and updates it without recreating the layer; a 404 from `GET /:id` on refresh marks the layer `gone` and the section shows `"Không có quyền xem hoặc đã bị xoá"`; the upload dialog requires a title, shows the pattern select only for `.zip`/`.tif`, the area field only for `.hdf`, and a 15-phút checkbox only for `.hdf`; while the job runs it reuses `my-maps/ui/JobProgress.view.tsx`; on success it adds the new item as a layer.
- [ ] **Step 2: Run, expect FAIL** — `npm run test -w @webatlas/web -- catalogue`.
- [ ] **Step 3: Implement. Step 4: Run, expect PASS; `npm run build:web` clean.**
- [ ] **Step 5: Commit** — `feat(web): chọn dữ liệu từ Danh mục, lớp Danh mục trên bản đồ, tải chuỗi thời gian lên`.

### Task 11: Web — shared time slider and hover value

**Files:**
- Create: `apps/web/src/features/time-slider/model/timeSlider.store.ts`, `model/timeSteps.ts`, `ui/TimeSlider.view.tsx`, `index.tsx`, tests
- Create: `apps/web/src/features/catalogue/model/useCatalogueHover.ts`, test
- Modify: `apps/web/src/app/MapScreen.tsx` (mount the slider along the bottom of the map, above the flood dock when both show), `apps/web/src/features/catalogue/index.tsx` (feed the visible time-series layers' steps to `setSteps`, pass `time` to `syncCatalogueLayers`), `apps/web/src/features/catalogue/model/catalogueLayers.ts` (per layer `TIME = stepAtOrBefore(item.timeSteps, time)`; `null` → layer not visible)

**Interfaces:**
- Produces:
  - `timeSteps.unionSteps(lists: string[][]) -> string[]` (sorted, unique ISO); `timeSteps.stepAtOrBefore(steps: string[], time: string) -> string | null`.
  - `timeSlider.store`: `{steps: string[], time: string | null, playing: boolean, speed: 1|2|4}`; `setSteps(steps)` (keeps `time` if still within range, else first step), `setTime`, `play`, `pause`, `stepBy(n)`; play advances one step per `1000 / speed` ms and stops at the end.
  - Catalogue layers send `TIME = stepAtOrBefore(layerSteps, time)`; when it is `null` the layer is hidden for that time.
  - `useCatalogueHover(map)`: on pointer rest (300 ms) over a visible time-series layer, GetFeatureInfo `INFO_FORMAT=application/json` through the proxy; tooltip `"<value> <unit> · <dd/MM/yyyy HH:mm>"`, nodata/empty → no tooltip.

- [ ] **Step 1: Failing tests**: `unionSteps([['2025-10-26T00:00:00Z'], ['2025-10-26T00:00:00Z','2025-10-26T01:00:00Z']])` has 2 entries; daily-rain layer at time `2025-10-26T13:00Z` asks for `2025-10-26T00:00Z`; a depth layer whose first step is `2025-10-25T00:00Z` is hidden at `2025-10-24T12:00Z`; slider hidden when no visible time-series layer; play stops at the last step; keyboard ←/→ steps (accessible name `"Thời điểm"`, value text in `dd/MM/yyyy HH:mm` local time); hover tooltip formatting for `0.3049` m → `"0,30 m"`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS; `npm run build:web`.**
- [ ] **Step 5: Commit** — `feat(web): thanh thời gian dùng chung cho các lớp chuỗi thời gian, xem giá trị khi rê chuột`.

### Task 12: Catalogue links inside personal maps

**Files:**
- Create: `apps/api/src/db/migrations/1000000000037_catalogue-map-layers.cjs`
- Modify: `apps/api/src/modules/workspace/{freeLayers,controller,schemas,maps}.ts` (add/list layer kind `catalogue`), `apps/api/src/modules/workspace/sharing.test.ts` (recipient case), `apps/web/src/features/my-maps/api/workspace.api.ts` (`LayerKind` adds `'catalogue'`, `LayerSummary.catalogue: CatalogueItem | null`), `apps/web/src/features/my-maps/model/personalLayers.ts` (delegate kind `catalogue` to `catalogueLayers`), `apps/web/src/features/my-maps/model/layerKindLabel.ts` (`"Liên kết Danh mục"`), `apps/web/src/features/catalogue/ui/CatalogueLayersSection.view.tsx` (button "Lưu vào bản đồ của tôi")

**Interfaces:**
- Produces (SQL): `workspace.map_layers.kind` check adds `'catalogue'`; nullable column `catalogue_resource_id uuid references catalogue.resources(id) on delete set null`, and no check tying it to the kind: the API requires it on create, and a link whose resource was deleted keeps its row with a null id, so the map shows "đã bị xoá" instead of losing the layer silently.
- Produces (API): `POST /api/workspace/maps/:mapId/layers` body `{kind: 'catalogue', resourceId, title?}`; the layer summary carries `catalogue: CatalogueItem | null` resolved with the *reader's* visibility (null when the reader cannot see it).

- [ ] **Step 1: Failing tests** (API): owner adds a link to a published item; a recipient sees it with `catalogue` filled; link to the owner's unpublished item → recipient sees `catalogue: null`; deleting the resource row keeps the layer with `catalogue: null`; adding a link to an invisible item → 404. (Web): a personal map with a catalogue link draws through `syncCatalogueLayers`; `catalogue: null` shows "Không có quyền xem hoặc đã bị xoá"; export of a map with a link skips it with the warning `"Lớp liên kết Danh mục không được xuất."`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run API `-- workspace catalogue` and web `-- my-maps catalogue`, expect PASS; `npm run build:web`.**
- [ ] **Step 5: Commit** — `feat: lưu liên kết Danh mục trong bản đồ cá nhân`.

### Task 13: End to end with the real files, browser check, runbook

**Files:**
- Create: `apps/web/scripts/verify-catalogue.mjs`, `docs/runbooks/catalogue-timeseries.md`
- Modify: `apps/web/package.json` (`"verify:catalogue": "node scripts/verify-catalogue.mjs"`), `infra/platform/README.md`, `README.md` (API routes list, progress)

- [ ] **Step 1: Bring the stack up** (platform compose + worker profile + Dagster), run migrations, rerun `platform-databases.sql` for the new grants.
- [ ] **Step 2: Upload the real HEC-RAS file** through the UI (`thubon_vugia_10_25.p01.hdf`, hourly) and a zip of MSWEP days `2025296`–`2025302`; record job durations and the output sizes in the runbook. Expected: 73 depth steps (25/10 00:00 → 28/10 00:00) and 7 rain steps.
- [ ] **Step 3: Write `verify-catalogue.mjs`** (puppeteer-core with system Chrome, as earlier verify scripts) at 1440 and 768 px: sign in through SSO; Thêm dữ liệu → Từ Danh mục; search `thubon`; the entry shows "Chưa duyệt"; add it; slider appears with 73 steps; step to 26/10 12:00 and assert the map image request carries `TIME=2025-10-26T12:00:00.000Z`; hover inside the river shows a value in m; add the rain entry; both play together; sign in as a second user and assert the unpublished entries are not in search; save the HEC-RAS link into a personal map, reload, the layer is restored.
- [ ] **Step 4: Run it, expect every step PASS**, with screenshots in the scratchpad.
- [ ] **Step 5: Write the runbook** (where files go, how to rerun, how to delete an entry: GeoNode delete + `delete_mosaic`), update READMEs.
- [ ] **Step 6: Commit** — `test(web): kịch bản trình duyệt cho Danh mục và chuỗi thời gian; sổ tay vận hành`.
