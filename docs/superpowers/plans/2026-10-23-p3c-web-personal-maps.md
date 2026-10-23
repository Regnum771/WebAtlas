# P3c: personal maps in the web app ("Bản của tôi"), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can, on the map:
- keep personal maps under *Bản của tôi*, and see maps shared with them;
- upload a file, watch the import, and see the result on the map;
- draw new layers and features, and edit a copy of an official layer;
- download a map as GeoPackage, GeoJSON or zipped Shapefile in a chosen coordinate system;
- share a map with users or groups; a recipient views it, downloads it or makes a copy;
- use a personal feature as an analysis region, and print personal layers with a legend.

An admin sees, under Quản lý, each user's personal-map counts, usage and quota (never content), and can change a quota.

**Architecture:**
- **One feature slice, `apps/web/src/features/my-maps`,** in the project's layout: `api/` (typed calls), `model/` (react-query hooks, presenters, a module store, OpenLayers layers), `ui/` (passive `*.view.tsx`), `index.tsx` (composition). It reads and writes only `/api/workspace/*` (P3a, P3b).
- **The map draws personal layers from its own model file,** `model/personalLayers.ts`, as `features/flood-scenario/model/floodLayers.ts` does. Every OpenLayers layer it adds carries `personal: true`, so the official popup and the official edit selection ignore it.
- **The server stays the gate.** Every write sends the map revision last read. A `409 MAP_CHANGED` reloads the map. Owner-only controls are hidden from recipients, and the API refuses them anyway.
- **Task 1 adds the few API pieces the screens need,** plus P3a/P3b follow-ups that belong to these screens.

**Tech stack:** React 19, @tanstack/react-query 5, OpenLayers 10 (`ol/source/GeoTIFF` with `ol/layer/WebGLTile` for rasters; `geotiff` comes with `ol`), Vitest 3 with Testing Library, Fastify 5 / PostgreSQL 16 for Task 1, Python 3.11 with rasterio for the raster part of Task 6, puppeteer-core for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md` §2: "On the map", "Sharing in the app", "Download", "Import and export jobs" (the interface polls), "Privacy". P3a (`b274831`) and P3b (`b416be5`) built the API and the worker.

Not in P3c:
- submit, review, publish (P4);
- column mapping into official layers (P5);
- personal layers as *targets* of select-within and nearest (P9, which builds query over layers);
- the 19 dams without geometry in an edit copy of dams: they cannot be drawn, so they cannot be edited here (P9's attribute table);
- snapping, split and merge, undo, coordinate entry (P8).

## Global Constraints

- **Text:**
  - User-facing copy is Vietnamese, exactly as written in this plan. Where the API sends a message (`error.message`, job step labels, `job.error`, export `warnings`), show it as it comes.
  - `apps/web/src/test/copy.test.ts` must keep passing.
  - Code comments are in English.
  - Commit messages are Vietnamese Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Layout of the slice** follows `features/access-groups`:
  - presenters in `model/use*Presenter.ts`, tested with `renderHook`;
  - views in `ui/*.view.tsx` take props only (no fetching, no map access) and are tested for text and roles;
  - API functions in `api/`, mocked with `vi.mock` in presenter tests. No test reaches the network.
- **OpenLayers imports** stay in `features/map/model/*` or in `features/my-maps/model/personalLayers.ts` / `personalStyle.ts`.
- **Map writes:** every content write sends `expectedRevision` = the revision of the last read of that map.
  - On `409 MAP_CHANGED`, the client refetches the map and shows `Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.`
  - A form keeps what the user typed, so they can retry.
- **Roles on a map** (`MapSummary.role`):
  - `owner` sees every control;
  - `recipient` sees the layers, toggles, *Tải xuống* and *Tạo bản sao*, and nothing that writes the map.
- **Anonymous visitors** see no *Bản của tôi* section.
- **Polling:** a queued or running job is polled every 1000 ms. Polling stops when the job is `succeeded` or `failed`, when the component that asked unmounts, or on a 401.
- **Byte sizes** are shown with `formatBytes` (Task 2): binary units, one decimal with a comma, `KB`/`MB`/`GB`, and a whole number shown without a decimal (`1073741824` → `1 GB`, `12_897_484` → `12,3 MB`).
- **Test hygiene for API tasks** (as in P3a/P3b):
  - each suite creates and deletes its own users (`p3c-<suite>-<who>@webatlas.test`);
  - roll back before release;
  - test file stores live under the OS temp directory;
  - keep each test file under 80 requests per address per minute. `freeLayers.test.ts` is already near that, so new layer tests go in a new file.
- **No recursive deletes** on this machine, in code, tests or scripts.
- **Checks before any claim of completion:**
  - `npm run test:web`
  - `npm run build:web` (type-checks; vitest does not)
  - `npm run lint:web`
  - `npm run test:api`
  - every `packages/atlas-data/tools/workspace/test_*.py`, run through `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 <file>`
  - `npx tsc -p apps/api/tsconfig.json --noEmit`
  - `npm run build:shared` if `packages/shared/src` changed

## Review Focus

These are the inputs and failure modes most likely to hurt a real user that no single task's happy path exercises, most likely first. Each one has a test in the task named after it.

1. **A large upload on a slow link.**
   - The dialog shows a percentage.
   - Closing the dialog or pressing *Huỷ* aborts the request and returns to an idle dialog.
   - A failed upload shows the API's message and queues no import.
   - → Task 5, `closing the dialog mid-upload aborts it and queues nothing`.
2. **A shapefile with no `.prj`.**
   - The job fails with `Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.`
   - The dialog then makes the coordinate system required and offers *Nhập lại* on the same uploaded file, with no second upload.
   - → Task 5, `a NO_CRS failure retries with the chosen CRS on the same file`.
3. **Two tabs writing the same map.**
   - The second write gets `MAP_CHANGED`.
   - The client reloads the map, shows the copy above, and keeps the form's values.
   - → Task 8, `MAP_CHANGED reloads the map and keeps the typed values`.
4. **A big layer** (an imported 20,000-row layer, an edit copy of rivers).
   - Features load by viewport up to the API's limit.
   - The panel shows the truncation note instead of freezing or fetching without a bound.
   - → Task 4, `a truncated read shows the note and every request carries a bbox`.
5. **A share revoked while the recipient has the map open.**
   - Their next read gets 404.
   - The map leaves their list with `Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.`, and its layers leave the map.
   - → Task 10, `a 404 on a shared map removes it and its layers`.

---

### Task 1: API additions the screens need, and P3a/P3b follow-ups

**Files:**
- Modify:
  - `apps/api/src/modules/workspace/jobs.ts` (`remove`)
  - `routes.ts`
  - `controller.ts`
  - `schemas.ts`
  - `maps.ts` (`get`)
  - `freeLayers.ts` (fields on update)
  - `sharing.ts` (targets)
  - `cleanup.ts:122`
  - `packages/atlas-data/tools/workspace/worker.py` (`keep_imported_original`)
- Create:
  - `apps/api/src/db/migrations/1000000000031_fold-text.cjs`
  - `apps/api/src/modules/workspace/freeLayerFields.test.ts`
- Test:
  - `jobs.test.ts`
  - `isolation.test.ts`
  - the maps test file that covers `GET /maps/:mapId`
  - `sharing` tests
  - `cleanup.test.ts`
  - `test_worker.py`

**Interfaces:**
- **Produces:**
  - `DELETE /api/workspace/jobs/:jobId`:
    - The job's owner gets 204.
    - A job that is queued or running gets 409 `JOB_RUNNING` `Công việc đang chạy, chưa xoá được.`
    - Anyone else gets 404 `Không tìm thấy công việc.`
    - For an export, the file row in `result.fileId` gets `delete_after = now()` in the same transaction, and then the job row is deleted. The API never unlinks.
  - `PATCH /api/workspace/maps/:mapId/layers/:layerId` accepts `fields: Array<{ name, type, from? }>` for a free layer:
    - an entry with `from` renames that field, and moves the key in every feature's `properties`;
    - an entry without `from` whose name is new adds a field;
    - a declared field left out of the list is removed, and its key is dropped from every feature;
    - a type change is refused with 400 `Không đổi kiểu được trường "<name>" vì đã có giá trị.` when any feature has a non-null value for that field;
    - the existing `Fields` rules (≤ 50 fields, no duplicates, `id` reserved) apply;
    - on any other layer kind, 400 `Loại lớp này chưa hỗ trợ thao tác này.`
  - `GET /maps/:mapId` by the **owner** sets `last_activity_at = now()` and `inactivity_notice_at = NULL`. A recipient's read changes neither.
  - `GET /share-targets?q=` matches users' full names and emails, and group names, ignoring case and Vietnamese diacritics (`ho` finds `Hồ`, `dien` finds `Điện`), through `workspace.fold_text(text)`.
  - `GET /admin/summary` rows gain `usageBytes` (`workspace.usage_bytes(user)`, so files count) and `quotaBytes`. A user with uploads but no map is listed too. The existing `bytes` (free features only) stays.

- [ ] **Step 1: Write the failing tests.**
  - `jobs.test.ts`:
    - `deleting a finished export frees its quota at once and its download answers 404`;
    - `a running job cannot be deleted (409 JOB_RUNNING)`.
  - `isolation.test.ts`: add `DELETE /jobs/:jobId` to the owner-scoped loop (another user's real id → 404).
  - Maps tests: `the owner reading a map refreshes its activity and clears a notice; a recipient's read does not`.
  - `freeLayerFields.test.ts`:
    - `renaming a field moves the key in every feature`;
    - `removing a field drops its key`;
    - `a type change is refused while values exist, allowed when none do`;
    - `fields on an edit copy are refused`.
  - Sharing: `share-target search ignores diacritics: "dien" finds "Điện"`.
  - Admin summary: `the summary counts an owner's files in usageBytes and lists a user who has only uploads`.
  - `cleanup.test.ts`: `an archived map's original is kept for a live map only by a succeeded import` (a failed import into a live map no longer keeps it). Change the existing `queuedLive` expectation to match.
  - `test_worker.py`: `keep_imported_original matches the files row by uuid`. Assert on the SQL text, or use `EXPLAIN` to show the index is used.
- [ ] **Step 2: Run** the focused files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Migration 031:
    - `CREATE EXTENSION IF NOT EXISTS unaccent`;
    - `workspace.fold_text(t text) RETURNS text` = `lower(unaccent('unaccent', t))`, declared `IMMUTABLE`, with `search_path` pinned;
    - EXECUTE revoked from PUBLIC and from `webatlas_assistant`, as migration 030 does;
    - down drops the function and leaves the extension in place.
  - Bind the escaped `q` once and compare `workspace.fold_text(col) LIKE workspace.fold_text($n)`.
- [ ] **Step 4: Run** them. Expected: PASS. Then run `npm run migrate:up -w @webatlas/api`, down, and up again, and paste the output in the report.
- [ ] **Step 5: Commit** `feat(api): xoá tệp đã xuất; sửa trường của lớp vẽ; đọc bản đồ tính là hoạt động; tìm người nhận không phân biệt dấu`

---

### Task 2: Web API client, transfers and queries

**Files:**
- Create in `apps/web/src/features/my-maps/`:
  - `api/workspace.api.ts`
  - `api/transfer.ts`
  - `model/queries.ts`
  - `model/formatBytes.ts`
  - their `*.test.ts`
- Modify: `apps/web/src/shared/api/apiClient.ts`, so a `FormData` body gets no JSON `Content-Type`; its test.

**Interfaces:**
- **Produces, `workspace.api.ts`:**
  - **Types** mirror the API: `MapSummary`, `MapDetail`, `LayerSummary` (`kind`, `title`, `position`, `style`, `geometryType`, `fields`, `layerKey`, `featureCount`, `raster`), `FieldDef { name; type: 'text'|'number'|'date' }`, `Job`, `JobStep`, `Share`, `ShareTargets`, `Upload`, `ExportPreview { layers: {layerId; title; truncated: {from; to}[]}[]; warnings: string[] }`, `FeatureCollectionResponse { type; features; truncated: boolean; changed?: string[] }`.
  - **Functions**, each a thin `apiRequest` over `/api/workspace`:
    - maps: `listMaps(): Promise<{ mine: MapSummary[]; sharedWithMe: MapSummary[] }>`, `getMap(id)`, `createMap({ title, description? })`, `updateMap(id, { title?, description?, expectedRevision })`, `deleteMap(id, expectedRevision)`, `copyMap(id)`;
    - layers: `addFreeLayer(mapId, { title, geometryType, fields, style?, expectedRevision })`, `addEditCopy(mapId, { layerKey, title?, expectedRevision })`, `updateLayer(mapId, layerId, { title?, style?, position?, fields?, expectedRevision })`, `removeLayer(mapId, layerId, expectedRevision)`;
    - features: `listFeatures(mapId, layerId, { bbox, limit? })`, `addFeature`, `updateFeature`, `removeFeature`;
    - shares: `listShares`, `addShare(mapId, { userId } | { groupId })`, `removeShare`, `searchShareTargets(q)`;
    - files and jobs: `listUploads(): Promise<{ uploads; usageBytes; quotaBytes }>`, `queueImport(mapId, { fileId, sourceCrs? })`, `queueExport(mapId, { format, crs, layerIds? }): Promise<{ job; warnings }>`, `previewExport(mapId, query)`, `getJob(id)`, `listJobs({ mapId? })`, `deleteJob(id)`;
    - admin: `adminSummary(): Promise<OwnerSummary[]>`, where `OwnerSummary = { userId; email; maps; layers; features; bytes; usageBytes; quotaBytes }`.
  - Every write that changes a map returns the new `revision` as the API does.
- **Produces, `transfer.ts`:**
  - `uploadFile(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Upload>`:
    - an `XMLHttpRequest` POST of `FormData` field `file`, with the bearer token from the same source as `apiClient`;
    - it rejects with `ApiError` built from the error body, or with `ApiError(0, 'ABORTED', …)` on abort.
  - `downloadJobFile(jobId): Promise<{ blob: Blob; filename: string }>`:
    - an authorized `fetch` of `/jobs/:id/download`;
    - the filename comes from `Content-Disposition` (`filename*=UTF-8''…`, else `filename="…"`, else `ban-do`);
    - `saveBlob(blob, filename)` clicks a temporary object-URL link.
- **Produces, `queries.ts`:**
  - query keys `['ws','maps']`, `['ws','map',id]`, `['ws','uploads']`, `['ws','job',id]`, `['ws','jobs',mapId]`;
  - `useMyMaps()`, `useMapDetail(id | null)`, `useUploads()`, `useJob(id | null)` (polling per the Global Constraints), `useMapJobs(mapId)`;
  - `useMapWrite(mapId)` returns `run<T>(write: (expectedRevision: number) => Promise<T>): Promise<T>`:
    - it reads the cached revision;
    - on success it invalidates `['ws','map',id]` and `['ws','maps']`;
    - on `MAP_CHANGED` it invalidates the same keys and throws `MapChangedError`, whose message is the constraint copy;
    - on 404 it invalidates `['ws','maps']`, drops `['ws','map',id]` and throws `MapGoneError` with `Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.`
- **Produces, `formatBytes.ts`:** `formatBytes(n: number): string`, per the Global Constraints.

- [ ] **Step 1: Write the failing tests.**
  - `formatBytes`: `1073741824 → "1 GB"`, `12897484 → "12,3 MB"`, `2048 → "2 KB"`, `0 → "0 KB"`.
  - `apiClient`: `a FormData body is sent without a JSON content type`.
  - `transfer`:
    - `uploadFile reports progress, resolves the upload, and an abort rejects with ABORTED` (fake XHR);
    - `downloadJobFile sends the token and reads filename* from Content-Disposition`.
  - `queries`:
    - `useJob polls every second until succeeded and then stops` (fake timers);
    - `useMapWrite sends the cached revision; MAP_CHANGED invalidates and throws MapChangedError; 404 throws MapGoneError`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- my-maps shared/api`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): lớp gọi API bản đồ cá nhân, tải tệp lên/xuống và truy vấn`

---

### Task 3: The *Bản của tôi* panel

**Files:**
- Create in `features/my-maps/`:
  - `model/myMaps.store.ts`
  - `model/useMyMapsPanelPresenter.ts`
  - `ui/MyMapsPanel.view.tsx`
  - `ui/MapCard.view.tsx`
  - `ui/LayerRow.view.tsx`
  - `index.tsx`
  - tests
- Modify:
  - `apps/web/src/app/MapScreen.tsx`: render `<MyMaps />` first in `SidePanelView`, followed by a `side-panel-rule` and then `<LayersPanel />`;
  - `apps/web/src/styles/main.css` (or the slice's own CSS imported there).

**Interfaces:**
- **Consumes:** Task 2.
- **Produces, `myMaps.store.ts`:** a module store like `shell.store.ts`. It holds `{ expanded: Set<mapId>; layers: Record<layerId, { visible: boolean; opacity: number }>; collapsed: boolean }` and offers:
  - `toggleExpanded(mapId)`;
  - `layerView(layerId)`, which defaults to `{ visible: true, opacity: 1 }` for a layer seen for the first time;
  - `setLayerVisible(layerId, v)`, `setLayerOpacity(layerId, o)`;
  - `forgetMap(mapId, layerIds)`;
  - `useMyMapsStore()`;
  - `resetMyMapsStore()`, for tests.
- **Produces, `<MyMaps />` (index.tsx):** it renders nothing unless the session is authenticated. Later tasks add their dialogs and controls through it.

**The panel:**

| Element | Copy |
|---|---|
| Section title (a button that collapses the section) | `Bản của tôi` |
| Group headings | `Của tôi`, `Được chia sẻ với tôi` |
| Empty own list | `Chưa có bản đồ nào. Tạo bản đồ mới hoặc tải tệp lên.` |
| Empty shared list | `Chưa ai chia sẻ bản đồ với anh/chị.` |
| Buttons | `Bản đồ mới`, `Tải tệp lên` (enabled in Task 5) |
| Create dialog | title `Bản đồ mới`; field `Tên bản đồ`; buttons `Tạo`, `Huỷ` |
| Map card | title; for a shared map, `của {ownerName}`; `{layerCount} lớp` |
| Owner actions | `Đổi tên`, `Xoá bản đồ` |
| Delete confirmation | title `Xoá bản đồ này?`; message `Các lớp, đối tượng và bản nháp trong bản đồ sẽ bị xoá. Không khôi phục được.`; confirm `Xoá` |
| Quota line, under the own list | `Đã dùng {formatBytes(usage)} / {formatBytes(quota)}` |
| Layer row | checkbox with the layer title; an opacity slider while visible; a kind label (`Lớp vẽ` for a free layer with declared fields, `Lớp từ tệp` for a free layer without, `Sửa lớp {official name}` for an edit copy, `Ảnh` for a raster) |

- [ ] **Step 1: Write the failing tests.**
  - Presenter:
    - `lists own and shared maps; a shared card names its owner`;
    - `creating a map adds it to Của tôi and expands it`;
    - `deleting asks first and sends the revision`;
    - `a recipient gets no rename or delete actions`.
  - View:
    - `shows both empty states`;
    - `shows the quota line`;
    - `an expanded card lists its layers with their kind labels`.
  - `MapScreen.test.tsx`: `Bản của tôi shows only when signed in`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** The section is collapsed state in the store; the default is open.
- [ ] **Step 4: Run** them. Expected: PASS. Run `npm run build:web` as well.
- [ ] **Step 5: Commit** `feat(web): mục "Bản của tôi" — bản đồ của tôi, được chia sẻ, tạo, đổi tên, xoá, dung lượng`

---

### Task 4: Personal vector layers on the map, the change overlay and the feature card

**Files:**
- Create in `features/my-maps/`:
  - `model/personalStyle.ts`
  - `model/personalLayers.ts`
  - `model/usePersonalLayersSync.ts`
  - `model/usePersonalPopupPresenter.ts`
  - `ui/PersonalFeatureCard.view.tsx`
  - tests
- Modify:
  - `features/map/model/styles.ts`: add `officialStyleFor(layerKey: EditableLayerKey): StyleLike`, which maps each editable layer to the style its official layer uses (dams through `makeDamsStyle(() => 'all')`);
  - `features/map/model/overlayLayers.ts`: add `PERSONAL_LAYER_PROP = 'personal'` and `isPersonalLayer(layer)`;
  - `components/DynamicPopup.tsx` and `features/map/model/SelectController.ts`: skip personal layers;
  - `features/my-maps/ui/LayerRow.view.tsx`: show the truncation note.

**Interfaces:**
- **Produces, `personalStyle.ts`:**
  - `PersonalLayerStyle { color: string; width: number; fillOpacity: number; pointRadius: number }`;
  - `DEFAULT_STYLE = { color: '#d9480f', width: 2, fillOpacity: 0.25, pointRadius: 6 }`;
  - `parseStyle(raw: Record<string, unknown>): PersonalLayerStyle`: unknown keys and bad values fall back to the defaults, and colours must match `/^#[0-9a-f]{6}$/i`;
  - `olStyleFor(style): Style` for free layers;
  - `CHANGED_OVERLAY: Style`, a 3 px dashed outline in `#7048e8`;
  - an edit copy is drawn with `officialStyleFor(layerKey)` ("drawn like the official layer", spec §2), and a feature whose `external_id` is in the read's `changed` list gets `CHANGED_OVERLAY` on top. An edit copy ignores `style` except for opacity.
- **Produces, `personalLayers.ts`:**
  - `syncPersonalLayers(map, entries: PersonalLayerEntry[])`. `PersonalLayerEntry = { mapId; layer: LayerSummary; visible; opacity; zIndex; onTruncated(layerId, n | null) }`.
  - Layer id `ws:<layerId>`, property `personal: true`.
  - **Vector layers** (`free`, `edit_copy`) use a `VectorSource` with the `bbox` strategy, and its loader calls `listFeatures(mapId, layerId, { bbox: extent in 4326, limit: 5000 })`. A `truncated: true` response calls `onTruncated(layerId, features.length)`.
  - `zIndex` = `800 + order`, where the order counts the expanded maps' layers top to bottom, so personal layers draw above official ones and below the ROI (997).
  - Entries that are gone are removed from the map.
  - `refreshPersonalLayer(map, layerId)` clears the source and reloads it (used by Tasks 7 and 8).
  - `personalFeatureAt(map, pixel): { mapId; layerId; feature: GeoJSON Feature } | null`.
- **Produces, `usePersonalLayersSync()`:** used once in `<MyMaps />`. It feeds `syncPersonalLayers` from the store and the expanded maps' details.
- **The feature card** opens on a click over a personal feature, unless a drawing or edit mode is active (`isDrawing()`, `drawingJustEnded()` and the editing flag, as `DynamicPopup` checks):
  - title: the layer title;
  - one row per property (`key: value`), with `null` shown as `—`;
  - close button `Đóng`.

Truncation note on the layer row: `Chỉ hiện {n} đối tượng đầu trong khung nhìn; phóng to để xem đủ.`

- [ ] **Step 1: Write the failing tests.**
  - `parseStyle`: `falls back per key; rejects a non-hex colour`.
  - Edit-copy style: `an edit copy uses its official layer's style; a changed feature gets the dashed overlay on top`.
  - `personalLayers`:
    - `adds one layer per visible entry with id ws:<id> and personal: true; removes stale ones`;
    - `a truncated read shows the note and every request carries a bbox` (mock `listFeatures`; drive the loader with two extents).
  - `DynamicPopup` / `SelectController`: `a click on a personal layer opens no official popup and selects nothing`.
  - Popup presenter: `shows the layer title and the properties, with null as —`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): vẽ lớp cá nhân trên bản đồ theo khung nhìn, đánh dấu chỗ đã sửa, thẻ thông tin đối tượng`

---

### Task 5: Upload and import with live progress

> **First visual checkpoint.** After this task, a user can upload a file and watch it land on the map. The controller tells the user, without pausing.

**Files:**
- Create in `features/my-maps/`:
  - `model/useUploadPresenter.ts`
  - `ui/UploadDialog.view.tsx`
  - `ui/JobProgress.view.tsx`
  - tests
- Modify: `index.tsx` and `MapCard.view.tsx` (owner action `Tải tệp lên vào bản đồ này`).

**Interfaces:**
- **Consumes:** `uploadFile`, `queueImport`, `useJob`, `createMap`, `refreshPersonalLayer`, the store.
- **Produces:** `useUploadPresenter({ targetMapId: string | null })` with these states:
  - `idle` → `uploading` (with `progress`) → `queued`/`running` (with the job) → `succeeded` or `failed`.
  - From `failed`: `retry(sourceCrs)` re-queues with the same `fileId`.
  - `close()` aborts an upload in flight and stops polling.

**Behaviour and copy:**
- Dialog title: `Tải tệp lên`.
- Hint: `GeoPackage, GeoJSON, Shapefile nén (.zip), KML hoặc GeoTIFF; tối đa 200 MB.`
- The file input is labelled `Chọn tệp`, with `accept=".gpkg,.geojson,.json,.zip,.kml,.tif,.tiff"`.
- A file over 200 MB is refused before sending, with `Tệp lớn hơn 200 MB.`
- `Nhập vào`:
  - a select of the user's own maps, plus `Bản đồ mới` (the default when opened from the section);
  - opened from a map card, that map is preselected;
  - `Bản đồ mới` creates a map titled after the file name without its extension, just before the import is queued.
- `Hệ toạ độ nguồn`:
  - the first option is `Theo tệp (tự nhận)`, then every `CRS_OPTIONS` alias;
  - choosing a non-WGS 84 option for a `.geojson`/`.json` file shows `Tệp GeoJSON thường đã ở WGS 84. Chỉ chọn hệ khác nếu chắc chắn toạ độ trong tệp là toạ độ phẳng.`
- Buttons: `Tải lên và nhập`, `Huỷ`.
- While uploading: `Đang tải lên… {n}%`.
- `JobProgress`:
  - lists `job.steps` with their API labels, and a state word for each: `Chờ`, `Đang chạy`, `Xong` or `Lỗi`;
  - a step's `message` is shown under it;
  - a bar shows `job.progress`.
- On success:
  - `Đã nhập xong.`, plus ` {rows} đối tượng.` when `result.rows > 0`;
  - the target map is expanded;
  - every new layer in `result.layerIds` is turned on, and the view fits their extent (the features' extent, or `raster.bounds4326`).
- On failure:
  - `job.error` is shown in an error `Message`;
  - if it equals `Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn.`, the CRS select loses its `Theo tệp` option and becomes required, and a `Nhập lại` button appears.
- API refusals (413 quota, 400 format) show `error.message`.

- [ ] **Step 1: Write the failing tests.**
  - `closing the dialog mid-upload aborts it and queues nothing`.
  - `a NO_CRS failure retries with the chosen CRS on the same file` (one `uploadFile` call, two `queueImport` calls, the second with `sourceCrs`).
  - `Bản đồ mới creates a map named after the file`.
  - `a file over 200 MB is refused before sending`.
  - `success turns on the new layers`.
  - `the GeoJSON CRS warning shows only for a .geojson with a non-WGS 84 choice`.
  - `JobProgress` view: `shows each step's label, state word and message`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): tải tệp lên và nhập vào bản đồ cá nhân, theo dõi tiến độ, chọn lại hệ toạ độ khi tệp thiếu`

---

### Task 6: Raster layers: display, transparent edges, value range

**Files:**
- Modify:
  - `packages/atlas-data/tools/workspace/import_raster.py`, `test_import_raster.py`;
  - `features/my-maps/model/personalLayers.ts` and its test;
  - `LayerRow.view.tsx` (a raster row has opacity only).

**Interfaces:**
- **Worker:**
  - A source with neither nodata nor an alpha band gets an alpha band in the COG (`dst_alpha`), so the warped edges are transparent.
  - The layer's `raster` metadata gains `stats: Array<{ min: number; max: number }>`, one per data band (not alpha), computed from the COG's smallest overview with nodata excluded.
- **Web:**
  - A `raster` entry becomes a `WebGLTile` layer over `GeoTIFF({ sources: [{ url: <API>/api/workspace/maps/:mapId/layers/:layerId/raster, min, max, nodata }], sourceOptions: { headers: { Authorization } }, normalize: true })`.
  - Bands:
    - 1 band is drawn grey;
    - 3 or more bands are drawn as RGB from bands 1–3;
    - the alpha band, when present, masks.
  - `min`/`max` come from `stats`. Without `stats`, `0`/`255` for `uint8` and no bounds otherwise.
  - The view-fit for a raster uses `raster.bounds4326`.

- [ ] **Step 1: Write the failing tests.**
  - `test_import_raster.py`:
    - `a source without nodata or alpha gets an alpha band; its corners are transparent after warping`;
    - `stats hold one min/max per data band and exclude nodata`.
  - Web:
    - `a raster entry builds a WebGLTile over the layer's raster URL with the bearer header`;
    - `stats set the source's min and max; a one-band raster draws grey`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS. Run every `test_*.py` in the workspace folder, since the raster change touches the shared import path.
- [ ] **Step 5: Commit** `feat: hiện lớp ảnh cá nhân trên bản đồ; ảnh nhập có viền trong suốt và dải giá trị theo từng kênh`

---

### Task 7: Managing layers: new drawn layer, edit copy, rename, style, order, fields, delete

**Files:**
- Create in `features/my-maps/`:
  - `model/useLayerEditorPresenter.ts`
  - `ui/NewLayerDialog.view.tsx`
  - `ui/EditCopyDialog.view.tsx`
  - `ui/LayerSettings.view.tsx`
  - `ui/FieldsEditor.view.tsx`
  - tests
- Modify: `MapCard.view.tsx` and `LayerRow.view.tsx` (owner actions).

**Interfaces:**
- **Consumes:** `useMapWrite`, `addFreeLayer`, `addEditCopy`, `updateLayer` (including `fields`), `removeLayer`, `refreshPersonalLayer`, `parseStyle`.
- **Produces:** `useLayerEditorPresenter(mapId)` with `createDrawn`, `createEditCopy`, `rename`, `setStyle`, `move(layerId, 'up' | 'down')`, `saveFields`, `remove`. Each goes through `useMapWrite`.

**Copy and rules:**
- Card action `Thêm lớp` opens a menu with `Lớp vẽ mới` and `Sửa một lớp chính thức`.
- **`Lớp vẽ mới`:**
  - fields `Tên lớp`, `Kiểu hình` (`Điểm`, `Đường`, `Vùng`) and `Trường thông tin`;
  - each field row has `Tên trường` and `Kiểu` (`Chữ`, `Số`, `Ngày`), plus `Xoá trường`;
  - `Thêm trường` adds a row;
  - submit with `Tạo lớp`.
- **`Sửa một lớp chính thức`:**
  - a select of the 8 editable layers by their display names (`LAYER_DISPLAY[LAYER_ATTRIBUTE_MAP[key].layerStateId].name`);
  - submit with `Tạo bản sửa`;
  - the title is left to the API.
- **Layer settings** (owner only):
  - `Đổi tên`;
  - for free layers only: `Màu` (colour input), `Độ dày nét` (1–8), and `Độ đậm vùng` (0–1, polygons only). Edit copies keep the official style, and rasters have only the row's opacity;
  - `Lên` and `Xuống`, disabled at the ends;
  - `Sửa trường`, for free layers only: the same rows, existing names editable (a rename), with `from` kept internally;
  - `Xoá lớp`.
- A style change applies at once, and is saved 500 ms after the last change.
- **Delete confirmation:**
  - title `Xoá lớp này?`;
  - message for an edit copy: `Bản nháp sửa lớp sẽ bị huỷ. Không khôi phục được.`;
  - otherwise: `Các đối tượng trong lớp sẽ bị xoá. Không khôi phục được.`;
  - confirm `Xoá`.

- [ ] **Step 1: Write the failing tests.**
  - `creating a drawn layer sends its fields and turns it on`.
  - `an edit copy is created from the chosen official layer`.
  - `renaming a field sends from and the new name`.
  - `style changes are saved once after 500 ms of quiet` (fake timers).
  - `Lên is disabled on the first layer`.
  - `deleting an edit copy shows the draft message`.
  - `a recipient sees no layer actions`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): quản lý lớp trong bản đồ cá nhân — lớp vẽ mới, bản sửa lớp chính thức, đổi tên, kiểu, thứ tự, trường, xoá`

---

### Task 8: Drawing and editing features in a personal map

**Files:**
- Create in `features/my-maps/`:
  - `model/usePersonalEditingPresenter.ts`
  - `ui/PersonalEditing.view.tsx`
  - `ui/FreeFeatureForm.view.tsx`
  - tests
- Modify:
  - `features/feature-editing/model/useAttributeFormPresenter.ts`: an optional `save` dependency, `(values, geometry) => Promise<SaveResult>`, used instead of the official create/update when given;
  - `features/feature-editing/model/useManagingUnitField.ts`: an option `anyUnit: true` that offers the whole unit tree, with the suggested unit as the default;
  - `features/map/model/mapEditing.tsx`: `startModifyFeature(feature, onChange)` for a feature handed in directly (a personal one), next to `startModify`;
  - their tests.

**Interfaces:**
- **Consumes:**
  - `useMapWrite`, `addFeature`, `updateFeature`, `removeFeature`;
  - `personalFeatureAt`, `refreshPersonalLayer`;
  - `useMapEditing().startDraw`, `cancelDraw`, `startModifyFeature`, `cancelModify`;
  - `AttributeFormView`.
- **Produces:**
  - Owner controls on an expanded map:
    - `Vẽ thêm`: pick a free or edit-copy layer; drawing uses the layer's geometry type (`point` → `Point`, `line` → `LineString`, `polygon` → `Polygon`), or the official layer's for an edit copy;
    - `Sửa đối tượng`: a mode with the hint `Bấm một đối tượng của bản đồ này để sửa.`
  - **The forms:**
    - a free layer uses `FreeFeatureForm`, with one input per declared field: text, a `type="number"` input, or a `type="date"` input;
    - an edit copy uses the official `AttributeFormView` through `useAttributeFormPresenter` with `save` and `anyUnit: true`;
    - buttons `Lưu`, `Huỷ`, `Sửa hình` and `Xoá đối tượng`;
    - delete confirmation: title `Xoá đối tượng này?`, message `Không khôi phục được.`, confirm `Xoá`.
  - **Rules:**
    - entering *Sửa đối tượng* or *Vẽ thêm* closes the official *Biên tập* tool, and the reverse is true too (`closeTool()` / a store flag), so only one editor holds the map's clicks;
    - closing the map card, collapsing the section or signing out cancels a drawing and leaves the mode.

- [ ] **Step 1: Write the failing tests.**
  - `drawing into a free layer posts the geometry and the typed fields, then refreshes the layer`.
  - `an edit-copy feature is saved through the workspace route, not /api/layers`.
  - `the managing unit picker in an edit copy offers units outside the user's jurisdiction`.
  - `MAP_CHANGED reloads the map and keeps the typed values`.
  - `opening Sửa đối tượng closes Biên tập`.
  - `deleting asks first`.
  - `useAttributeFormPresenter without save still calls the official API` (regression).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, with the whole `feature-editing` suite and `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): vẽ và sửa đối tượng trong bản đồ cá nhân, cả bản sửa lớp chính thức`

---

### Task 9: Download: preview, export job, file list

**Files:**
- Create in `features/my-maps/`:
  - `model/useExportPresenter.ts`
  - `ui/ExportDialog.view.tsx`
  - `ui/ExportsList.view.tsx`
  - tests
- Modify: `MapCard.view.tsx` (action `Tải xuống` for owner and recipient).

**Interfaces:**
- **Consumes:** `previewExport`, `queueExport`, `useJob`, `useMapJobs`, `deleteJob`, `downloadJobFile`, `saveBlob`, `CRS_OPTIONS`.
- **Produces:** the dialog and its list:
  - **Dialog title:** `Tải xuống bản đồ`.
  - **Options:**
    - `Định dạng`: `GeoPackage (.gpkg)`, `GeoJSON`, `Shapefile nén (.zip)`;
    - `Hệ toạ độ`: every `CRS_OPTIONS` alias, default `wgs84-dd`;
    - `Lớp`: a checklist of the map's non-raster layers, all checked.
  - **Preview:**
    - the preview is fetched 300 ms after the last change;
    - under `Tên trường sẽ đổi`, a table with columns `Lớp`, `Tên cũ`, `Tên mới`, shown only when a layer has `truncated` entries;
    - the API's `warnings` as a list;
    - with no layers: `Không có lớp nào để xuất.`, and `Xuất` disabled.
  - **Buttons:** `Xuất`, `Đóng`. `Xuất` shows `JobProgress`. On success, `Tải tệp` downloads through `downloadJobFile`, which an `<a href>` without the token could not do.
  - **`Tệp đã xuất`:**
    - the map's export jobs from `useMapJobs`, newest first;
    - each row reads `Xuất lúc {time} · hết hạn {date}`, where the expiry is `finishedAt + 7 days` (`vi-VN` format);
    - the row offers `Tải`, plus `Xoá` (which calls `deleteJob`);
    - failed rows show `job.error`;
    - empty list: `Chưa có tệp nào.`

- [ ] **Step 1: Write the failing tests.**
  - `the preview lists cut Shapefile names and the API warnings`.
  - `no layers disables Xuất`.
  - `Tải tệp downloads with the token, not a plain link`.
  - `Xoá removes the row and refreshes the quota`.
  - `a recipient can export`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): tải bản đồ xuống — xem trước tên trường và cảnh báo, theo dõi việc xuất, danh sách tệp đã xuất`

---

### Task 10: Sharing, the recipient's view, copies

**Files:**
- Create in `features/my-maps/`:
  - `model/useSharePresenter.ts`
  - `ui/ShareDialog.view.tsx`
  - tests
- Modify:
  - `MapCard.view.tsx`: owner action `Chia sẻ`; recipient action `Tạo bản sao`;
  - `model/usePersonalLayersSync.ts` and `queries.ts`, to handle a lost map.

**Interfaces:**
- **Consumes:** `listShares`, `addShare`, `removeShare`, `searchShareTargets`, `copyMap`, `MapGoneError`, `forgetMap`.
- **Produces:**
  - **The share dialog:**
    - title `Chia sẻ bản đồ`;
    - search `Tìm người dùng hoặc nhóm` with the hint `Gõ ít nhất 2 ký tự.`, searched 300 ms after the last keystroke;
    - result headings `Người dùng` (name and email) and `Nhóm`, each row with `Chia sẻ`;
    - `Đang chia sẻ với` lists the current shares with `Thu hồi`, or `Chưa chia sẻ với ai.` when there are none;
    - revoke confirmation: title `Thu hồi chia sẻ với {name}?`, message `Người này sẽ không còn xem được bản đồ. Bản sao họ đã tạo vẫn là của họ.`, confirm `Thu hồi`.
  - **`Tạo bản sao`:** creates the copy, which appears in `Của tôi`, expanded, with the toast `Đã tạo bản sao “{title}”.`
  - **A map that answers 404** to any read or write (`MapGoneError`, or a 404 from `getMap` or `listFeatures`):
    - the map leaves the lists;
    - its layers leave the map (`forgetMap`);
    - a toast shows `Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.`

- [ ] **Step 1: Write the failing tests.**
  - `searching needs 2 characters and shows users and groups`.
  - `sharing adds the target to Đang chia sẻ với`.
  - `revoking asks first`.
  - `Tạo bản sao adds the copy to Của tôi`.
  - `a 404 on a shared map removes it and its layers`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): chia sẻ bản đồ cá nhân với người dùng hoặc nhóm, người nhận xem và tạo bản sao`

---

### Task 11: A personal feature as the analysis region; personal layers in print

**Files:**
- Modify:
  - `features/my-maps/ui/PersonalFeatureCard.view.tsx` and its presenter;
  - `pages/print/model/usePrintPage.ts`, `pages/print/ui/PrintPage.view.tsx` and `pages/print/index.tsx`;
  - their tests.

**Interfaces:**
- **Consumes:** `setRoi` (`features/roi/model/roi.store`); the store and the expanded maps' details.
- **Produces:**
  - **The feature card** gains `Dùng làm vùng phân tích`.
    - For a `Point`, `LineString` or `Polygon`, it calls `setRoi({ source: 'drawn', geometry }, { fit: 'ifOutside' })`. That opens *Vùng phân tích* through the existing reaction in `MapScreen`.
    - A geometry over the API's vertex cap for analysis input (`MAX_INPUT_VERTICES`) shows the API's 400 message, as a drawn region does today.
    - For a multi-part geometry, the button is disabled, with the hint `Đối tượng nhiều phần chưa dùng được làm vùng phân tích.`
  - **The print page** gains a legend group `Bản của tôi`, listing each visible personal layer as a swatch in its style colour and its title. A raster shows a grey-to-colour bar swatch.

- [ ] **Step 1: Write the failing tests.**
  - `a polygon feature becomes the drawn ROI`.
  - `a MultiPolygon feature disables the button with the hint`.
  - `print lists visible personal layers under Bản của tôi; hidden ones are left out`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): dùng đối tượng cá nhân làm vùng phân tích; in kèm chú giải lớp cá nhân`

---

### Task 12: Quản lý: personal-map usage and quotas (admin)

**Files:**
- Create:
  - `apps/web/src/pages/quan-ly/sections/BanDoCaNhan.tsx`
  - `features/my-maps/model/useUsagePresenter.ts`
  - `features/my-maps/ui/UsageTable.view.tsx`
  - tests
- Modify:
  - `apps/web/src/app/App.tsx`: lazy route `/quan-ly/ban-do-ca-nhan`;
  - `pages/quan-ly/index.tsx`: its nav entry, for admin only;
  - the user-management API file in `features/user-management`, if it lacks `quotaBytes`.

**Interfaces:**
- **Consumes:** `adminSummary` (Task 2, with Task 1's fields); `PATCH /api/users/:id { quotaBytes }` (exists).
- **Produces:**
  - Nav label and page title: `Bản đồ cá nhân`.
  - Intro line: `Quản trị viên chỉ thấy số lượng và dung lượng, không thấy nội dung bản đồ.`
  - Table columns:
    - `Người dùng` (email);
    - `Bản đồ`;
    - `Lớp`;
    - `Đối tượng`;
    - `Đã dùng` (`formatBytes(usageBytes)`);
    - `Hạn mức`: `formatBytes(quotaBytes)`, with `Sửa`. That opens a number input in GB (one decimal allowed), saved as `Math.round(gb * 1073741824)` bytes, with buttons `Lưu` and `Huỷ`.
  - Rows are ordered by `usageBytes`, largest first. A row at or over its quota is marked with `Vượt hạn mức`.
  - A non-admin reaching the route is redirected like the other admin-only sections.

- [ ] **Step 1: Write the failing tests.**
  - `lists owners with usage and quota, largest first`.
  - `saving 2,5 GB sends 2684354560 bytes`.
  - `a row over its quota is marked`.
  - `the nav entry and the route are admin-only`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS, along with `npm run build:web`.
- [ ] **Step 5: Commit** `feat(web): Quản lý — dung lượng bản đồ cá nhân theo người dùng và sửa hạn mức`

---

### Task 13: Browser check, runbook, full checks

**Files:**
- Create: `apps/web/scripts/verify-personal-maps.mjs`, written in the style of `verify-permissions.mjs`.
- Modify:
  - `apps/web/package.json`: script `verify:personal-maps`;
  - `README.md`: one paragraph under the worker runbook.

**Interfaces:** none new.

- [ ] **Step 1: Write the script.**
  - It runs at 1440×900 and 768×900, prints one PASS/FAIL line per step, and exits non-zero on any FAIL.
  - Accounts come from the environment:
    - `VERIFY_OWNER_EMAIL` / `VERIFY_OWNER_PASSWORD`;
    - `VERIFY_RECIPIENT_EMAIL` / `VERIFY_RECIPIENT_PASSWORD`.
  - Steps:
    1. The owner signs in, opens *Bản của tôi* and creates the map `Kiểm thử P3c`.
    2. The owner uploads a small GeoJSON that the script writes into its `--out` folder: three points and one polygon in Đà Nẵng, with Vietnamese attribute values. The owner waits for `Đã nhập xong.` and checks that the layer row is on and the map canvas has drawn pixels where the features are. Screenshot.
    3. The owner adds a drawn polygon layer with one text field, draws a polygon, fills the field and saves. The feature card shows the value.
    4. The owner exports as `Shapefile nén (.zip)` in `vn2000-tm3-da-nang`, sees the cut-name table if any, downloads, and checks that the downloaded zip holds `.cpg` and `.prj`.
    5. The owner shares with the recipient. The recipient signs in, sees the map under `Được chia sẻ với tôi`, sees no `Đổi tên`/`Xoá bản đồ`/`Chia sẻ`, and makes a copy.
    6. The owner revokes the share. The recipient's next refresh removes the map, with the toast.
    7. At 768: nothing covers the scale bar or the coordinate readout, and the panel does not scroll sideways.
    8. Cleanup: through the API, the script deletes both test maps, the copy, the uploads and the export jobs. No file-system deletes.
  - Needs: the Docker stack with the `worker` profile up, the API, and `npm run dev:web`.
- [ ] **Step 2: Run** `npm run verify:personal-maps -w @webatlas/web -- --out <scratch dir>`. Expected: every line PASS. Attach the screenshots' paths in the report.
- [ ] **Step 3: Run the full checks** from the Global Constraints, one after another. Take a read-only count of `workspace.maps`, `workspace.files`, `workspace.jobs` and `@webatlas.test` users before and after. They must be equal.
- [ ] **Step 4: Commit** `test(web): kiểm tra trên trình duyệt luồng bản đồ cá nhân — tải lên, vẽ, xuất, chia sẻ, thu hồi; hướng dẫn chạy`
