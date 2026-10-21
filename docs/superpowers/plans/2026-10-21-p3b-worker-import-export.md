# P3b: GDAL worker, uploads, import/export and quota, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can, through the API:
- upload a GeoPackage, GeoJSON, zipped Shapefile, KML or GeoTIFF;
- import it into a personal map as free layers, or as a raster layer;
- export a map as GeoPackage, GeoJSON or zipped Shapefile in a coordinate system chosen from `crs.ts`.

A worker container running GDAL does the conversions. A per-user quota bounds what can be stored.

**Architecture:**
- **Jobs.** The API owns access, validation and job parameters. It writes rows into `workspace.jobs`.
- **Worker.** A Python worker runs in the existing atlas-tools image (pyogrio, rasterio and pyproj are already pinned) as one more Compose service. It claims jobs with `FOR UPDATE SKIP LOCKED`, reports per-step progress, and reads and writes the database and a shared file store.
- **One definition for logic both sides need.** Three pieces of logic are needed by both the API (TypeScript) and the worker (Python): the edit-copy read, the map revision bump and the usage count. Each lives in PostgreSQL once, as a function in schema `workspace`, and both sides call it.
- **Data the API owns.** Registry facts the worker needs (relation names, attribute columns), proj4 strings from `crs.ts`, and Shapefile field names reach the worker inside the job's parameters. The worker never duplicates a TypeScript table.

**Tech stack:**
- Fastify 5 with `@fastify/multipart` (new dependency);
- PostgreSQL 16 / PostGIS 3.4;
- Python 3.11 with pyogrio 0.10, geopandas 1.0, rasterio 1.4, pyproj 3.7 and psycopg2 (already in `packages/atlas-data/tools/requirements.txt`);
- Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md` §2: "Personal maps" (raster layer), "Import and export jobs", "Download" and "Limits and cleanup", plus assumption 3, which the user approved. P3a (merged, `b274831`) built maps, free and edit-copy layers, sharing and the inactivity cleanup.

What P3b does not cover:
- the web interface (P3c);
- flow 1 and flow 2 (P5/P7);
- notification delivery (P4).

## Global Constraints

- **Formats read:** GeoPackage (`.gpkg`), GeoJSON (`.geojson`, `.json`), zipped Shapefile (`.zip`), KML (`.kml`) and GeoTIFF (`.tif`, `.tiff`). Any other extension is refused at upload with 400 `Định dạng tệp không được hỗ trợ.`
- **Formats written:** `gpkg`, `geojson` and `shp` (always zipped).
- **Coordinate systems:**
  - The source and target CRS are chosen by `CrsOption.id` from `packages/shared/src/crs.ts`. An unknown id gets 400.
  - The API puts the option's `proj4` into the job parameters, and the worker never keeps its own CRS table.
  - `wgs84-dms` exports exactly like `wgs84-dd`.
  - All stored geometry is EPSG:4326, 2D.
- **Limits** (spec assumption 3, approved):
  - a file is at most **200 MB**;
  - an import is at most **200,000 rows** in total across the file's layers;
  - the quota is **1 GB** per user by default (`1073741824` bytes), and admin can change it.
- **Usage:** the bytes of the user's live files, plus `pg_column_size(geom) + pg_column_size(properties)` over the free features of all their maps, archived ones included.
- **Job statuses:** exactly `queued`, `running`, `succeeded`, `failed`. Kinds: exactly `import`, `export`.
- **Shapefile:**
  - field names are at most 10 characters;
  - one geometry type per file, so the export splits a layer by geometry type;
  - styles are lost;
  - the field names that will be cut are listed **before** downloading;
  - text is UTF-8, with a `.cpg` file.
- **Rasters:**
  - an uploaded GeoTIFF becomes a Cloud-Optimized GeoTIFF in **EPSG:3857** (DEFLATE, with internal overviews);
  - the original file is always kept;
  - rasters are display-only, served by byte range after an owner/recipient check.
- **Privacy:**
  - uploads, jobs and exports belong to their owner, and anyone else gets 404;
  - a raster layer's file is readable by the map's owner and its recipients, exactly like its features.
- **No recursive deletes on this machine:** in code, tests or scripts.
  - Files are removed one by one with `fs.unlink` / `os.remove`, and only after checking that the resolved path lies inside the store root.
  - Empty directories may be left behind.
- **Text:** user-facing copy is Vietnamese, exactly as written in this plan. Code comments are in English. Commit messages are in Vietnamese and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test hygiene** (as in P2/P3a):
  - each suite creates and deletes its own `app.users` rows (`p3b-<suite>-<who>@webatlas.test`);
  - roll back before release, and use `runStages` from `@webatlas/versioning/testing`;
  - pin every version of a real layer before committing an activation, and restore atomically;
  - synthetic dam `external_id`s for P3b are `9011xx`;
  - test file stores live under the OS temp directory, never the repository;
  - logins are limited to 10 a minute, and requests to 100 a minute per address, so cache tokens and keep each file's request count under 80.
- **Python tests** follow `packages/atlas-data/tools/flood_scenario/test_depth.py`:
  - plain scripts that print `ok` / `FAIL` and exit non-zero on failure, with no pytest;
  - they run inside the atlas-tools image:
    `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 <file>`.
- **Checks before any claim of completion:**
  - `npm run test:api`
  - `npm run test -w @webatlas/versioning`
  - `npm run test -w @webatlas/atlas-data`
  - every `packages/atlas-data/tools/workspace/test_*.py`
  - `npx tsc -p apps/api/tsconfig.json --noEmit`
  - `npx tsc -p packages/shared/tsconfig.json --noEmit`, then `npm run build:shared` if `packages/shared/src` changed

## Review Focus

The inputs and failure modes most likely to hurt a real user that no single task's happy path exercises, most likely first. Each one has a test in the task named after it.

1. **A Vietnamese agency file in VN-2000 TM-3 without a `.prj`.**
   - The import fails with a message asking for the source coordinate system.
   - With `sourceCrs: 'vn2000-tm3-da-nang'` it lands in the right place: a known point within 1 m.
   - → Task 6, `a shapefile without .prj needs a source CRS and then lands within a metre`.
2. **A Shapefile whose `.dbf` text is Vietnamese.** Text must read correctly when a `.cpg` names the encoding. Without a `.cpg`, it falls back from UTF-8 to Windows-1258 and never crashes. → Task 6, `dbf text is decoded by its cpg`.
3. **An upload that would exceed the quota, or a file over 200 MB.**
   - It is refused before anything is stored.
   - A refused upload leaves no file on disk and no row behind.
   - → Task 3, `an upload over the quota is refused and leaves nothing behind`.
4. **The worker dies mid-job.** The job does not stay `running` forever: it is failed with a clear message once its heartbeat is stale, and half-written layers are not left in the map. → Task 5, `a stale running job is failed and its partial writes are rolled back`.
5. **A map exported as GeoPackage and imported back** restores the layer titles and styles, and keeps the edit-copy features' `external_id`s. → Task 9, `gpkg round trip restores titles, styles and external ids`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/db/migrations/1000000000028_workspace-files-jobs.cjs` | `workspace.files`, `workspace.jobs`, the raster columns on `map_layers`, `app.users.quota_bytes`, and the SQL functions `workspace.bump_map`, `workspace.usage_bytes` and `workspace.edit_copy_rows` |
| `apps/api/src/db/workspaceFilesJobs.test.ts` | Shape, checks and privileges of the new tables and functions |
| `apps/api/src/modules/workspace/fileStore.ts` | The store root, resolving paths safely, writing a stream, unlinking one file |
| `apps/api/src/modules/workspace/uploads.ts` | Uploads with quota and limits; listing and deleting uploads; downloading the original |
| `apps/api/src/modules/workspace/jobs.ts` | Queueing import and export jobs (it builds their parameters); reading jobs; downloading results; the export preview |
| `apps/api/src/modules/workspace/rasters.ts` | Serving a raster layer's COG with HTTP Range |
| `packages/shared/src/shapefileNames.ts` | `shapefileFieldNames(names)`: the 10-character naming used by both the preview and the worker (via job parameters) |
| `packages/atlas-data/tools/workspace/worker.py` | Claim loop, heartbeat, steps, stale recovery, `--once` |
| `packages/atlas-data/tools/workspace/jobs_db.py` | psycopg2 helpers: claim, heartbeat, step and progress updates, finish |
| `packages/atlas-data/tools/workspace/import_vector.py` | Reading vector files with pyogrio, reprojecting, writing free layers, restoring GPKG metadata |
| `packages/atlas-data/tools/workspace/import_raster.py` | GeoTIFF to COG in EPSG:3857, metadata, a raster layer |
| `packages/atlas-data/tools/workspace/export_vector.py` | Writing GPKG, GeoJSON and zipped SHP in the target CRS, plus the metadata table |
| `packages/atlas-data/tools/workspace/test_*.py` | One test script per module, against the dev DB and a temp store |
| `infra/docker-compose.yml` | Service `worker` |
| `apps/api/src/config/env.ts` | `WORKSPACE_FILES_DIR` |

---

### Task 1: Files, jobs, quota and the shared SQL functions

**Files:**
- Create: `apps/api/src/db/migrations/1000000000028_workspace-files-jobs.cjs`, `apps/api/src/db/workspaceFilesJobs.test.ts`
- Modify: `apps/api/src/modules/workspace/access.ts`. `bumpMap` becomes `SELECT workspace.bump_map($1)`, with unchanged behaviour.

**Interfaces:**
- Produces these tables.
  - **`workspace.files`**
    - `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`
    - `owner_id uuid NOT NULL → app.users ON DELETE CASCADE`
    - `kind text NOT NULL CHECK (kind IN ('upload','cog','export'))`
    - `path text NOT NULL`, relative to the store root and unique
    - `original_name text NOT NULL`
    - `content_type text NOT NULL`
    - `size_bytes bigint NOT NULL CHECK (size_bytes >= 0)`
    - `created_at timestamptz NOT NULL DEFAULT now()`
    - `delete_after timestamptz NULL`
    - index on `(owner_id)`
  - **`workspace.jobs`**
    - `id uuid` primary key
    - `owner_id uuid NOT NULL → app.users ON DELETE CASCADE`
    - `map_id uuid NULL → workspace.maps ON DELETE CASCADE`
    - `kind text CHECK IN ('import','export')`
    - `status text NOT NULL DEFAULT 'queued' CHECK IN ('queued','running','succeeded','failed')`
    - `params jsonb NOT NULL`
    - `steps jsonb NOT NULL DEFAULT '[]'`
    - `progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100)`
    - `result jsonb NULL`
    - `error text NULL`
    - `created_at`
    - `started_at`, `finished_at` and `heartbeat_at` (`timestamptz NULL`)
    - partial index on `(created_at) WHERE status = 'queued'`
  - **New columns on `workspace.map_layers`:**
    - `file_id uuid NULL → workspace.files ON DELETE SET NULL`
    - `raster jsonb NULL`
    - `CHECK (kind <> 'raster' OR raster IS NOT NULL)`
  - **New column on `app.users`:** `quota_bytes bigint NOT NULL DEFAULT 1073741824 CHECK (quota_bytes >= 0)`
- Produces these functions.
  - **`workspace.bump_map(p_map uuid) RETURNS integer`**
    - The exact semantics of today's `bumpMap`: `revision + 1`, `updated_at = last_activity_at = now()`, `inactivity_notice_at = NULL`.
    - Returns the new revision.
  - **`workspace.usage_bytes(p_owner uuid) RETURNS bigint`**
    - Following the Global Constraints: files with `delete_after IS NULL OR delete_after > now()`, plus free-feature bytes.
  - **`workspace.edit_copy_rows(p_table regclass, p_relation regclass, p_draft uuid, p_geom text, p_columns text[], p_bbox geometry DEFAULT NULL, p_limit integer DEFAULT NULL) RETURNS TABLE (id text, geometry jsonb, properties jsonb)`**
    - Language plpgsql, `STABLE`.
    - It runs exactly the algorithm in `featuresRepository.editCopyFeaturesInBBox` today:
      - the `p_relation` rows minus the external_ids the draft holds a row for, `UNION ALL` the draft's own live rows;
      - when `p_bbox` is not null, both halves are filtered with `&& p_bbox`;
      - `ORDER BY id`, `LIMIT p_limit` when not null.
    - `properties = jsonb_build_object('external_id', external_id::text)` merged with each of `p_columns`.
    - Identifiers go through `format('%I')`, and `regclass` prints itself safely.
- Privileges: `REVOKE ALL` on the new tables and functions from `PUBLIC` and `webatlas_assistant`.

- [ ] **Step 1: Write the failing tests** in `workspaceFilesJobs.test.ts`. Everything is rolled back except the cascade case.
  - `files and jobs reject bad kinds and statuses`: 23514 for each.
  - `a raster layer needs raster metadata`.
  - `quota_bytes defaults to 1 GiB`.
  - `bump_map behaves like bumpMap`: revision +1, the notice cleared, activity moved.
  - `usage_bytes counts live files and free features, not expired files`.
  - `the assistant role can use none of it`:
    - `has_table_privilege` is false for both tables;
    - `has_function_privilege('webatlas_assistant', 'workspace.edit_copy_rows(regclass,regclass,uuid,text,text[],geometry,integer)', 'EXECUTE')` is false.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- workspaceFilesJobs`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** Run `npm run migrate:up -w @webatlas/api`, then `migrate:down` and `migrate:up` again. Point `bumpMap` at the function.
- [ ] **Step 4: Run** the test, plus `npm run test -w @webatlas/api -- workspace`. Expected: PASS. The P3a suites prove that `bumpMap` is unchanged.
- [ ] **Step 5: Commit** `feat(db): tệp, công việc, hạn mức và các hàm dùng chung giữa API và máy xử lý`

---

### Task 2: The edit-copy read goes through `workspace.edit_copy_rows`

**Files:**
- Modify: `apps/api/src/modules/layers/repository.ts`. `editCopyFeaturesInBBox` calls the function.
- Test: `apps/api/src/modules/workspace/editCopies.test.ts`, which is unchanged and must pass. Also add `apps/api/src/modules/layers/editCopyRows.test.ts`.

**Interfaces:**
- Consumes `workspace.edit_copy_rows` from Task 1.
- Produces:
  - `editCopyFeaturesInBBox(client, def, draftId, bbox, limit)`, with an unchanged signature and result. It calls the function with `(def.table, activeRelation(def), draftId, def.geomColumn, def.attributeColumns, envelope, limit + 1)`.
  - `editCopyRowsArgs(def: LayerDef, draftId: string): { table: string; relation: string; geomColumn: string; columns: string[] }`, exported for Task 4's export parameters.

- [ ] **Step 1: Write the failing test** in `editCopyRows.test.ts`: `the SQL function and the registry agree for every editable layer`.
  - For each key in `EDITABLE_LAYER_KEYS`, `editCopyRowsArgs(getLayer(key), uuid).relation` equals `activeRelation(getLayer(key))`.
  - Inside a rolled-back transaction, calling `workspace.edit_copy_rows` for `dams`, with a fresh draft and no bbox, returns the same id set as `SELECT id FROM water.dams_active`.
- [ ] **Step 2: Run** it. Expected: FAIL, because `editCopyRowsArgs` is not exported.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test -w @webatlas/api -- editCopyRows editCopies workspace`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(api): đọc lớp "Sửa lớp" qua một hàm SQL dùng chung với máy xử lý`

---

### Task 3: File store, uploads and quota

**Files:**
- Create: `apps/api/src/modules/workspace/fileStore.ts`, `uploads.ts`, `uploads.test.ts`
- Modify:
  - `apps/api/package.json`: add the dependency `@fastify/multipart`.
  - `apps/api/src/config/env.ts`: `WORKSPACE_FILES_DIR`, an optional string. The default is `<repo root>/var/workspace-files`, resolved from this file's location.
  - `.gitignore`: add `/var/`.
  - `routes.ts`, `controller.ts`, `schemas.ts`, `server.ts` (register multipart for the workspace routes only).
  - `apps/api/src/modules/users/{schemas,service,repository}.ts`: admin's `PUT /api/users/:id` accepts `quotaBytes: number (integer ≥ 0)`, and user responses include `quotaBytes`.

**Interfaces:**
- Produces, in `fileStore.ts`:
  - `storeRoot(): string`.
  - `resolveInStore(relPath: string): string`. It throws if the resolved absolute path is outside `storeRoot()`.
  - `writeStream(relPath: string, source: Readable, maxBytes: number): Promise<number>`. It returns the bytes written. Above `maxBytes` it unlinks the partial file and throws `FileTooLargeError`.
  - `unlinkInStore(relPath: string): Promise<void>`. It removes one file, and a missing file is ignored. Never recursive.
- Produces `uploadsService(pg)`.
  - **`upload(user, part: { filename, mimetype, file: Readable })`** returns `{ upload }`.
    1. Check the extension against the allow-list.
    2. Stream to `uploads/<ownerId>/<fileId>/original<ext>`.
    3. Insert a `files` row with kind `upload`.
    4. Recheck quota after the write, in one transaction: insert the row, then read `workspace.usage_bytes(owner)` and `quota_bytes`.
    5. If usage is over the quota, roll back, unlink the file, and fail.
  - **`list(user)`** returns `Upload[]`, where `Upload = { id, originalName, sizeBytes, createdAt }`.
  - **`remove(user, fileId)`**: deletes the row, then unlinks the file.
  - **`original(user, fileId)`** returns `{ absPath, originalName, contentType }`.
  - Only the owner may use any of these; anyone else gets 404 `Không tìm thấy tệp.`
- Errors:
  - **Quota:** `413 QUOTA_EXCEEDED` with the message `Vượt hạn mức dung lượng: đã dùng <a>, hạn mức <b>.`, where `<a>` and `<b>` are formatted in MB with one decimal and a Vietnamese decimal comma.
  - **Size:** `413 FILE_TOO_LARGE` with the message `Tệp lớn hơn 200 MB.`
  - **Extension:** `400 VALIDATION_ERROR` with the message `Định dạng tệp không được hỗ trợ.`
- Routes, each with `app.authenticate`:
  - `POST /uploads`: multipart, one field `file`, answers `201 { upload }`.
  - `GET /uploads`: answers `{ uploads, usageBytes, quotaBytes }`.
  - `GET /uploads/:fileId`: streams the original with `Content-Disposition: attachment; filename*=UTF-8''<encoded>`.
  - `DELETE /uploads/:fileId`: answers 204.

- [ ] **Step 1: Write the failing tests** in `uploads.test.ts`. Point `WORKSPACE_FILES_DIR` at a fresh directory under `os.tmpdir()` for the file. Each test unlinks only the files it created.
  - `a gpkg upload is stored and listed`: check the size and that the file exists at the expected relative path.
  - `an unsupported extension is refused`: `.exe` and `.csv` get the exact copy.
  - `a file over 200 MB is refused and leaves nothing behind`: set the limit through the service's injectable `maxBytes`, which defaults to 200 MB. A 2 KB limit with a 3 KB body is refused, no row is written and no file is left.
  - `an upload over the quota is refused and leaves nothing behind`: set the user's `quota_bytes` to 1000 and upload 2 KB. Expect 413 `QUOTA_EXCEEDED`, the exact copy prefix, no row and no file.
  - `uploads are private`: another user gets 404 on GET and DELETE, and the upload is absent from their list.
  - `admin sets a user's quota`: `PUT /api/users/:id {quotaBytes: 5}`, then `GET /uploads` as that user shows `quotaBytes: 5`. A non-admin gets 403.
  - `resolveInStore refuses an escaping path`: `../x` and an absolute path both throw.
- [ ] **Step 2: Run** `npm install` (adds `@fastify/multipart`), then `npm run test -w @webatlas/api -- uploads`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite, plus `npm run test -w @webatlas/api -- users workspace`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): tải tệp lên kho riêng, giới hạn 200 MB và hạn mức dung lượng theo người dùng`

---

### Task 4: Jobs API, export preview and Shapefile names

**Files:**
- Create: `packages/shared/src/shapefileNames.ts` (+ export from `index.ts`, + `shapefileNames.test.ts`), `apps/api/src/modules/workspace/jobs.ts`, `jobs.test.ts`
- Modify: `routes.ts`, `controller.ts`, `schemas.ts`

**Interfaces:**
- **In `packages/shared`:**
  - `shapefileFieldNames(names: string[]): Array<{ from: string; to: string }>`.
  - It returns one entry per input, in order:
    1. Every `to` is unique, case-insensitively.
    2. Every `to` is at most 10 characters.
    3. Unchanged names stay unchanged.
    4. A cut name is the first 10 characters. On a clash it becomes the first 8 characters plus `_` plus a counter from 1, so `ten_cong_trinh` → `ten_cong_t` and the next clash → `ten_cong_1`.
- **Produces `jobsService(pg)`.**
  - **`enqueueImport(user, mapId, { fileId, sourceCrs?: string })`** returns `{ job }` with status 201.
    - Only the owner may import: resolve `mapRole` (P3a Task 2). `null` gets the map 404, and `recipient` gets the P3a 403 `Chỉ người tạo bản đồ được sửa bản đồ này.`
    - There is no revision check. The job appends layers and bumps the revision itself, and the client refreshes.
    - The upload must be the user's.
    - `sourceCrs`, when given, must be a `CRS_OPTIONS` id.
  - **`enqueueExport(user, mapId, { format: 'gpkg'|'geojson'|'shp', crs: string, layerIds?: string[] })`** returns `{ job }` with status 201.
    - The map must be readable by `user`, owner or recipient.
    - The layers are those named in `layerIds`, or all free and edit-copy layers. Raster layers are skipped.
  - **`preview(user, mapId, { format, crs, layerIds? })`** returns `{ layers: Array<{ layerId, title, truncated: Array<{from,to}> }>, warnings: string[] }`. Warnings, exactly:
    - for `shp`: `Shapefile không giữ kiểu hiển thị.` and `Mỗi loại hình học được ghi thành một tệp riêng.`;
    - when any raster layer is skipped: `Lớp ảnh không được xuất; tải ảnh riêng từ lớp đó.`;
    - for `geojson` with a CRS other than WGS 84: `GeoJSON ngoài WGS 84 không theo chuẩn RFC 7946.`
  - **`get(user, jobId)`** returns `Job`. **`list(user, { mapId? })`** returns `Job[]`, the newest 50.
    - `Job = { id, kind, status, mapId, progress, steps, result, error, createdAt, finishedAt }`. No `params`.
  - **`download(user, jobId)`** returns `{ absPath, downloadName, contentType }`. It is for a succeeded export job only; anything else gets 404.
- **Job parameters (contract for Tasks 5–8, all camelCase JSON):**
  - **import:**
    ```
    { fileId, path, originalName, mapId, ownerId, maxRows: 200000,
      sourceCrs: { id, proj4 } | null }
    ```
  - **export:**
    ```
    { mapId, ownerId, mapTitle, format, crs: { id, proj4 },
      downloadName,                                   // "<map title slug>.<gpkg|zip|geojson>"
      layers: [{ layerId, kind: 'free'|'edit_copy', title, style, geometryType,
                 fields,                              // free layers
                 editCopy: { table, relation, draftId, geomColumn, columns } | null,
                 shpNames: Array<{from,to}> | null }] }
    ```
  - **result:**
    - for import: `{ layerIds: string[], rows: number }`;
    - for export: `{ fileId }`, where the export file row is kind `export` with `delete_after = now() + 7 days`.
  - **steps:** an array of `{ key, label, status: 'pending'|'running'|'done'|'failed', message? }`.
    - Import keys and labels: `read` `Đọc tệp`, `transform` `Chuyển hệ toạ độ`, `write` `Ghi vào bản đồ`.
    - Export keys and labels: `read` `Đọc dữ liệu`, `write` `Ghi tệp`, `package` `Đóng gói`.
    - The API writes the steps as `pending` when it queues the job.
- **Routes:**
  - `POST /maps/:mapId/imports`
  - `POST /maps/:mapId/exports`
  - `GET /maps/:mapId/exports/preview?format=&crs=&layerIds=`
  - `GET /jobs?mapId=`
  - `GET /jobs/:jobId`
  - `GET /jobs/:jobId/download`
  - Jobs are owner-only. The map routes follow P3a access: a stranger gets 404, and a recipient gets 403 for imports but may export.

- [ ] **Step 1: Write the failing tests.**
  - In `shapefileNames.test.ts`: `short names pass, long names cut, clashes numbered, case-insensitive`.
  - In `jobs.test.ts`:
    - `queueing an import stores the contract`:
      - the params match the shape above;
      - the proj4 equals `findCrs('vn2000-tm3-da-nang').proj4`;
      - the steps are three `pending` entries with the exact labels.
    - `a recipient may export but not import`.
    - `export params describe edit copies through editCopyRowsArgs`: the relation for a rivers edit copy is `water.rivers_detail`.
    - `the shapefile preview lists cut names and warns`:
      - a drawn layer with field `ten_cong_trinh_thuy_loi` → `ten_cong_t`;
      - the two exact Shapefile warnings.
    - `jobs are private`: a stranger gets 404 on get and download, and the job is absent from their list.
    - `download is refused until the export succeeds`: 404 while queued. After a test sets the job to succeeded with a real file in the temp store, the response is 200 with `Content-Disposition`.
    - `unknown CRS id is refused`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- shapefileNames` and `npm run test -w @webatlas/api -- jobs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `npm run build:shared`.
- [ ] **Step 4: Run** both suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): xếp hàng công việc nhập và xuất; xem trước tên trường Shapefile`

---

### Task 5: The worker: claim, steps, heartbeat, stale recovery, Compose service

**Files:**
- Create: `packages/atlas-data/tools/workspace/worker.py`, `jobs_db.py`, `test_worker.py`
- Modify: `infra/docker-compose.yml` (service `worker`)

**Interfaces:**
- Produces, in `jobs_db.py`:
  - `connect() -> connection`: from `DATABASE_URL`.
  - `claim(conn) -> dict | None`:
    - `SELECT … WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    - then set `status='running', started_at=heartbeat_at=now()`.
  - `heartbeat(conn, job_id)`.
  - `set_step(conn, job_id, key, status, message=None, progress=None)`.
  - `succeed(conn, job_id, result: dict)`.
  - `fail(conn, job_id, message: str)`: marks the running step as `failed`, sets `error` and `finished_at`.
  - `fail_stale(conn, older_than_seconds=600) -> int`.
- Produces, in `worker.py`:
  - `HANDLERS: dict[str, Callable[[conn, job], dict]]`, keyed by kind. Tasks 6–8 register `import` (dispatching on extension to vector or raster) and `export`.
  - `run_once(conn) -> bool`: claim one job and run it.
    - All of the handler's database writes go in ONE transaction that commits only on success.
    - Step updates and heartbeats run on a second connection with autocommit, so they are visible while the job runs.
    - Any exception means rollback and `fail(job, message)`. The message is the exception's `user_message` attribute when present; otherwise it is `Lỗi không mong đợi khi xử lý tệp.`, and the traceback goes to stdout.
  - `main()`:
    - runs `fail_stale` at start and every minute, with the message `Máy xử lý đã dừng giữa chừng; hãy chạy lại.`;
    - loops `run_once`, sleeping 2 s when idle;
    - `--once` runs a single `run_once` and exits.
  - `class UserFacingError(Exception)`, with `user_message: str`.
  - Store root: `WORKSPACE_FILES_DIR`, which defaults to `/repo/var/workspace-files`.
- **Compose service `worker`:**
  - `image: webatlas-atlas-tools`, with the same `build` as `tools`;
  - `working_dir: /repo`, volume `..:/repo`;
  - environment: `DATABASE_URL` (in-network, as for `tools`), `PYTHONUNBUFFERED: "1"`, `WORKSPACE_FILES_DIR: /repo/var/workspace-files`;
  - `command: ["python3", "packages/atlas-data/tools/workspace/worker.py"]`;
  - `depends_on: db: condition: service_healthy`;
  - `restart: unless-stopped`;
  - no profile.

- [ ] **Step 1: Write the failing tests** in `test_worker.py`. It inserts its own user, map and jobs by SQL, uses a fake handler registered for the test, and deletes its rows at the end in a `finally`.
  - `claim takes the oldest queued job once`: two connections, and only one gets the job.
  - `a succeeding handler commits its writes and records the result`.
  - `a failing handler rolls back its writes and records the user message`: the handler inserts a map layer and then raises `UserFacingError('X')`. No layer exists, `status='failed'`, `error='X'`, and the running step is `failed`.
  - `a stale running job is failed and its partial writes are rolled back`:
    - set `status='running'` and `heartbeat_at = now() - 11 min` by SQL;
    - `fail_stale` returns 1, and the error has the exact copy;
    - a handler that crashed mid-transaction left nothing, which the previous test proves.
  - `steps and progress are visible while running`: the handler reads the job on the second connection mid-run.
- [ ] **Step 2: Run** `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/workspace/test_worker.py`. Expected: FAIL (`import error`).
- [ ] **Step 3: Implement**, including the Compose service.
- [ ] **Step 4: Run** the test, then `docker compose -f infra/docker-compose.yml config --quiet`. Expected: PASS and exit 0.
- [ ] **Step 5: Commit** `feat(worker): máy xử lý nhận việc từ workspace.jobs, báo từng bước, tự đánh dấu việc treo`

---

### Task 6: Vector import

**Files:**
- Create: `packages/atlas-data/tools/workspace/import_vector.py`, `test_import_vector.py`. Fixture files are generated by the test into a temp directory, so nothing binary is committed.
- Modify: `worker.py` (register it)

**Interfaces:**
- Consumes: the import params from Task 4; `workspace.bump_map` and `workspace.usage_bytes` from Task 1.
- Produces `run_import_vector(conn, job, steps) -> {'layerIds': [...], 'rows': n}`.
  - **Read.** `pyogrio.list_layers` reads the source:
    - for `.zip`, every `.shp` inside, read with GDAL's `/vsizip/`;
    - for `.kml`, every folder layer.
  - **Row limit.** The total row count must be at most `maxRows`. Otherwise fail with `Tệp có hơn 200.000 dòng.`
  - **CRS.** Each layer's CRS comes from the file, or else from `sourceCrs.proj4`.
    - GeoJSON without a `crs` member counts as EPSG:4326 (RFC 7946).
    - A layer with neither fails with `Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.`
  - **Transform.** Reproject to EPSG:4326, then force 2D. Rows with an empty or null geometry are skipped and counted in the step message as `Bỏ qua <n> dòng không có hình học.`
  - **Write**, in the handler's transaction:
    1. Lock the map with `SELECT … FOR UPDATE`. If it is archived or missing, fail with `Bản đồ không còn.`
    2. For each source layer, insert a `free` map layer with:
       - title = the layer name, or for a single-layer file the original file name without extension;
       - `geometry_type` = point, line or polygon when every row has that family, otherwise NULL;
       - `fields = []`;
       - position appended.
    3. Insert features with `properties` = all original columns as JSON (dates as ISO strings, numbers as numbers), plus `source_row` (1-based) and `source_crs` (the authority code or proj4).
    4. Call `workspace.bump_map` once.
    5. Check `workspace.usage_bytes(owner)` against `quota_bytes`. Over the quota, fail with `Vượt hạn mức dung lượng.`, which rolls everything back.
  - **Restoring a GeoPackage written by this app.** When the GPKG holds a table `webatlas_metadata` (see Task 8), the titles and styles come from it, the layer order follows it, and `external_id` stays a plain property.
  - **Shapefile encoding.** It comes from the `.cpg` file when present. Without one, try UTF-8 and fall back to `cp1258` on a decode error. Never crash on text.

- [ ] **Step 1: Write the failing tests** in `test_import_vector.py`. Generate the fixtures with geopandas into a temp directory. Each test creates its own user and map and cleans up.
  - `geojson import makes one free layer with all columns`: 3 points, columns `ten` (text), `dung_tich` (float), `ngay` (date). Expect one layer with 3 features, `properties` holding the three keys with their types, `source_row` 1..3, and the map revision +1.
  - `a shapefile without .prj needs a source CRS and then lands within a metre`:
    - a point written in `vn2000-tm3-da-nang` coordinates for a known WGS 84 point (108.2022, 16.0544). Compute it in the test with pyproj from the same proj4 string as `crs.ts`, copied into the test as a constant with a comment naming the source.
    - Without `sourceCrs`, the job fails with the exact copy.
    - With it, the stored point is within 1 m of the known point, measured with `ST_Distance(geography)`.
  - `dbf text is decoded by its cpg`: a shapefile with `ten = 'Hồ Phú Ninh'`, with a `.cpg` reading `UTF-8`. The value round-trips exactly. Without a `.cpg`, the import still succeeds.
  - `a multi-layer gpkg makes one layer per source layer`.
  - `too many rows fails and writes nothing`: `maxRows=2` with 3 rows gives the exact copy, and no layer is created.
  - `rows without geometry are skipped and reported`.
  - `3D input is stored 2D`.
  - `importing into an archived map fails with Bản đồ không còn.`
- [ ] **Step 2: Run** it in the tools image. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, plus `test_worker.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): nhập tệp vector thành lớp tự do — giữ mọi cột gốc, chuyển về WGS 84, đọc đúng mã hoá`

---

### Task 7: Raster import and serving the COG

**Files:**
- Create: `packages/atlas-data/tools/workspace/import_raster.py`, `test_import_raster.py`, `apps/api/src/modules/workspace/rasters.ts`, `rasters.test.ts`
- Modify: `worker.py`, `routes.ts`, and `controller.ts` (the R1 dispatch). Raster layers get only the GET `raster` route; their feature routes stay `unsupported()`.

**Interfaces:**
- Produces, in Python, `run_import_raster(conn, job, steps) -> {'layerIds': [id], 'rows': 0}`.
  - The source CRS comes from the file, or from `sourceCrs.proj4`; with neither, it fails with the Task 6 message.
  - It warps to EPSG:3857 and writes a COG with `driver='COG', compress='DEFLATE'` and overviews, at `cog/<ownerId>/<fileId>.tif`.
  - It inserts a `files` row of kind `cog` and a `raster` map layer with `file_id` = the COG and this metadata:
    `raster = { width, height, bands, dtype, nodata, bounds4326: [minX,minY,maxX,maxY], sourceCrs }`.
  - It calls `bump_map` and checks the quota against the COG plus everything else.
- Produces, in the API:
  - `GET /maps/:mapId/layers/:layerId/raster` serves the COG with `Accept-Ranges: bytes`:
    - `206` with `Content-Range` for a valid single `Range: bytes=a-b` or `bytes=a-`;
    - `416` for an unsatisfiable range;
    - `200` for no range.
  - Access is through `assertCanRead`, so a stranger gets 404, the same body as for a missing map. A layer that is not a raster gets 400 `Loại lớp này chưa hỗ trợ thao tác này.`
  - `Content-Type: image/tiff`.

- [ ] **Step 1: Write the failing tests.**
  - `test_import_raster.py`:
    - `a geotiff becomes a 3857 COG with metadata`: a small 64×64 GeoTIFF in EPSG:4326, made with rasterio. The output opens with `driver == 'GTiff'`, its `crs` is EPSG:3857, it has overviews, and its `raster.bounds4326` is within 1e-6 of the input bounds.
    - `a tiff without crs needs a source crs`.
  - `rasters.test.ts`. Insert the raster layer and the files row by SQL, and put a 1000-byte file in the temp store.
    - `range requests return 206 with the right bytes`.
    - `a stranger gets 404 identical to a missing map, a recipient gets 200`.
    - `bad range gets 416`.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both, plus `npm run test -w @webatlas/api -- isolation`. Add the new route to `isolation.test.ts`'s table: the sweep must stay complete.
- [ ] **Step 5: Commit** `feat: nhập GeoTIFF thành COG EPSG:3857, giữ tệp gốc; phục vụ ảnh theo khoảng byte cho chủ và người được chia sẻ`

---

### Task 8: Vector export

**Files:**
- Create: `packages/atlas-data/tools/workspace/export_vector.py`, `test_export_vector.py`
- Modify: `worker.py`

**Interfaces:**
- Consumes: the export params from Task 4, and `workspace.edit_copy_rows` from Task 1, called with the params' `editCopy` fields and no bbox or limit.
- Produces `run_export(conn, job, steps) -> {'fileId': id}`.
  - **Reading layers.**
    - A free layer reads `workspace.features`, with properties expanded to columns.
    - An edit copy reads `edit_copy_rows`. Its properties include `external_id`.
  - **Reprojection.** Reproject to `crs.proj4`.
  - **`gpkg`:** one file, one table per layer. The table name is the layer title slugged to `[a-z0-9_]`, made unique. It also holds a table `webatlas_metadata(layer_table text, layer_id text, kind text, title text, style text, position integer, map_title text)`.
  - **`geojson`:**
    - With one layer, a single `.geojson` file.
    - With more than one, a `.zip` holding one `.geojson` per layer.
    - Non-WGS 84 output is written with GDAL's `RFC7946=NO` and a `crs` member.
  - **`shp`:** a `.zip` holding, per layer and per geometry family present, `<slug>_<diem|duong|vung>.shp/.shx/.dbf/.prj/.cpg`, with field names renamed by the layer's `shpNames`. The `.cpg` reads `UTF-8`.
  - **Output.** The file is written to `exports/<ownerId>/<jobId>/<downloadName>`. The worker inserts a `files` row of kind `export` with `delete_after = now() + interval '7 days'`. Export files count toward usage until they expire. The export itself is not refused for quota, because the file is temporary.

- [ ] **Step 1: Write the failing tests** in `test_export_vector.py`, using its own user and map: a free layer with 2 points and 1 line, plus an edit copy of dams with one edited synthetic dam (`9011xx`). Pin and restore dams as the TypeScript suites do, through SQL.
  - `gpkg holds every layer, the metadata table and external ids`.
  - `geojson of one layer is a single file in WGS 84`.
  - `shapefile zip splits by geometry and uses the given short names`: a `_diem` and a `_duong` set; the `.dbf` field names equal the `shpNames.to` values; the `.cpg` is present.
  - `vn2000 tm-3 export round-trips within a metre`: read the GPKG back with pyogrio and reproject the point to 4326. It is within 1 m of the stored point.
  - `the export file row expires in 7 days`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, plus all `test_*.py` in the folder. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): xuất bản đồ ra GeoPackage, GeoJSON và Shapefile nén theo hệ toạ độ chọn từ crs.ts`

---

### Task 9: File lifecycle, isolation and the round trip

**Files:**
- Modify:
  - `apps/api/src/modules/workspace/cleanup.ts`:
    - `deleteExpiredFiles(pg, now, scope?)`;
    - `archiveNoticed` also marks the map's import originals.
  - `cleanup.test.ts`;
  - `apps/api/src/scripts/workspaceCleanup.ts`, which runs `deleteExpiredFiles` every time;
  - `isolation.test.ts`, adding every new route;
  - `maps.ts` `remove`, layer delete for raster.
- Create: `packages/atlas-data/tools/workspace/test_round_trip.py`

**Interfaces:**
- Produces:
  - **`deleteExpiredFiles(pg, now: Date, scope?: { ownerIds?: string[] }) => Promise<number>`.** For files with `delete_after < now`, it unlinks the file through `unlinkInStore`, then deletes the row. Each file is handled on its own, and a missing file on disk does not stop the sweep.
  - **Archiving.** When `archiveNoticed` archives a map, each `upload` file that is the `fileId` of an import job of that map, and of no import job of a map that is not archived, gets `delete_after = now + 90 days`. Spec: "keeps its original files for another 90 days".
  - **Deleting a raster layer, or a map with raster layers.** In the same transaction, set `delete_after = now()` on its `cog` file rows. The next sweep removes them. The API never unlinks inside a request transaction.

- [ ] **Step 1: Write the failing tests.**
  - `cleanup.test.ts`:
    - `archiving marks the map's import originals for 90 days; a file also imported into a live map is kept`.
    - `expired files are unlinked and their rows deleted; a missing file does not stop the sweep`.
    - `deleting a raster layer schedules its COG for removal`.
  - `isolation.test.ts`: extend the route table with:
    - `POST /maps/:mapId/imports`
    - `POST /maps/:mapId/exports`
    - `GET /maps/:mapId/exports/preview`
    - `GET /maps/:mapId/layers/:layerId/raster`

    Stranger and admin get 404, identical to a missing map. Owner-scoped routes (`/uploads…`, `/jobs…`) go in their own loop with a real id for another user, expecting 404.
  - `test_round_trip.py`: `gpkg round trip restores titles, styles and external ids`.
    1. Export a map with a styled free layer and an edit copy.
    2. Import the resulting GPKG into a new map.
    3. The titles and styles are equal, the layer order is equal, and every edit-copy feature's `external_id` property is present.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat: vòng đời tệp — giữ tệp gốc 90 ngày sau lưu trữ, tệp xuất hết hạn sau 7 ngày; cách ly các đường dẫn mới`

---

### Task 10: End to end through the API and the real worker; full checks

**Files:**
- Create: `apps/api/src/modules/workspace/workerE2E.test.ts`. It is opt-in: `describe.skipIf(process.env.WORKER_E2E !== '1')`.
- Modify: `docs/` runbook section in `README.md`, under the existing dev-run section: how to start the worker, run its tests, and run the opt-in test.

**Interfaces:** none new.

- [ ] **Step 1: Write the test** `upload, import, export and download through the API with the real worker`. With `WORKSPACE_FILES_DIR` set to the repo's `var/workspace-files`, which the worker container also mounts:
  1. Upload a GeoJSON.
  2. Queue an import.
  3. Run `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/workspace/worker.py --once` through `child_process.execFileSync`.
  4. `GET /jobs/:id` shows `succeeded` with all steps `done`, and the map has the layer.
  5. Queue a `shp` export in `vn2000-tm3-da-nang`, run the worker once, and download it. The response is a zip whose entries include `.cpg` and `.prj`.
  6. Clean up: delete the map, the uploads and its own users. Delete the job files with `unlinkInStore`, file by file.
- [ ] **Step 2: Run** `WORKER_E2E=1 npm run test -w @webatlas/api -- workerE2E`. Expected: PASS. Without the variable it is skipped.
- [ ] **Step 3: Run the full checks** from the Global Constraints, one after another. Take a read-only count before and after of:
  - pins, drafts, `workspace.maps`, `workspace.files`, `workspace.jobs`;
  - `@webatlas.test` users;
  - active versions per layer.

  The counts must be equal.
- [ ] **Step 4: Commit** `test: kiểm thử đầu-cuối tải lên, nhập, xuất qua API với máy xử lý thật; hướng dẫn chạy`
