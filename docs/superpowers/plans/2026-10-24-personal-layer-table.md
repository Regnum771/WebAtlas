# Personal-layer table and a tidier *Bản của tôi* card, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a personal map, the user opens a layer's table docked under the map, filters and sorts its features on the server, selects a feature from the table or the map, and edits it in the existing form beside the table. The map card shrinks to two buttons and a ⋯ menu.

**Architecture:**
- **API:** one new read route per layer, `POST /api/workspace/maps/:mapId/layers/:layerId/query`.
  - A pure *filter compiler* (`layerQuery.ts`) turns the request into SQL fragments with bound parameters.
  - A *source* gives every layer kind the same `(id, properties jsonb, geom)` shape: free layers from `workspace.features`, edit copies from `workspace.edit_copy_rows`.
- **Web:** a new part of `features/my-maps`:
  - a table store (which layer, filter, sort, page, selection);
  - a query hook;
  - a docked table view mounted in the map stage.
- **Reuse:** editing reuses `usePersonalEditingPresenter` and its forms; the map-click "Sửa đối tượng" mode is removed.

**Tech stack:** Fastify 5, PostgreSQL 16/PostGIS 3.4, zod; React 19, @tanstack/react-query 5, OpenLayers 10; Vitest 3 with Testing Library; puppeteer-core for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-24-personal-layer-table-design.md` (decisions T1–T8; sections 1–4). It builds on P3c (`features/my-maps`, main `529a9db`).

## Global Constraints

- **Text:** user-facing copy is Vietnamese, exactly as written in the spec or this plan. API messages are shown as they come. `apps/web/src/test/copy.test.ts` must keep passing. Code comments are in English. Commit messages are Vietnamese Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Layout** follows `features/my-maps`:
  - presenters in `model/use*Presenter.ts`, tested with `renderHook`;
  - views in `ui/*.view.tsx` take props only;
  - API functions in `api/`, mocked with `vi.mock`. No web test reaches the network.
- **OpenLayers imports** stay in `features/map/model/*` or in `features/my-maps/model/personalLayers.ts`, `personalStyle.ts` and `rasterLayer.ts`.
- **Map writes** go through `useMapWrite(mapId).run(...)` (queued per map; the revision comes from the previous write's answer; `MAP_CHANGED` and `MAP_BUSY` messages shown as they come).
- **SQL safety:**
  - a field name is accepted only if it is in the layer's column list;
  - every user value is a bound parameter;
  - a JSON key is read as `properties ->> $n` with the key bound, never interpolated.
- **API test hygiene** as in P3a–P3c:
  - each suite creates and deletes its own users (`p3d-<suite>-<who>@webatlas.test`);
  - roll back before release;
  - test stores live under the OS temp dir;
  - keep each test file under 80 requests per address per minute.
- **Desktop only** (T7).
- **No recursive deletes** on this machine, in code, tests or scripts.
- **Checks before any claim of completion:**
  - `npm run test:web`, `npm run build:web`, `npm run lint:web`;
  - `npm run test:api`, `npx tsc -p apps/api/tsconfig.json --noEmit`;
  - the browser check `npm run verify:personal-maps -w @webatlas/web` (Task 8).

## Review Focus

1. **An imported column with mixed values** (mostly numbers, some `"N/A"` or `"1.200,5"`).
   - It is typed `text`, so number operators are not offered for it.
   - A number condition sent anyway on a text-looking value matches nothing and raises no error.
   - → Task 1 test `a non-numeric value never matches a number condition and never errors`; Task 2 test `a column with any non-number value is typed text`.
2. **Column names from files** with spaces, diacritics, quotes or SQL text (`Tên đập`, `a'b`, `x"; DROP TABLE t;--`).
   - They filter and sort correctly.
   - Nothing reaches SQL text.
   - → Task 1 test `keys with quotes and SQL text are bound, never interpolated`; Task 2 test `a column named with quotes and spaces filters and sorts`.
3. **A big edit copy:** rivers, about 23,000 rows, sorted on a text column with no "in view" box.
   - A page returns within 1.5 s.
   - → Task 2 test `a filtered, sorted page of a rivers edit copy returns within 1.5 s`.
4. **Editing a feature so it stops matching the filter** (changing `loai` while filtering on it).
   - The row leaves the page after the save.
   - The form stays open with the note *Đối tượng này không khớp bộ lọc*.
   - → Task 7 test `a saved feature that no longer matches stays open with the note`.
5. **Fast typing in the search box.**
   - Only the last input is shown; an older answer arriving late never replaces a newer one.
   - Typing waits 300 ms before querying.
   - → Task 3 test `typing quickly sends one query after 300 ms and a late older answer is ignored`.

---

### Task 1: The filter compiler (pure)

**Files:**
- Create: `apps/api/src/modules/workspace/layerQuery.ts`, `apps/api/src/modules/workspace/layerQuery.test.ts`
- Modify: `apps/api/src/modules/workspace/schemas.ts` (the request schema)

**Interfaces:**
- **Produces, `schemas.ts`:**
  - `LayerQueryBody` (zod):
    - `q?: string` (≤ 200 chars);
    - `conditions: { field: string; op: Op; value?: string | number }[]` (≤ 10; default `[]`);
    - `match: 'all' | 'any'` (default `'all'`);
    - `bbox?: [minX, minY, maxX, maxY]`;
    - `sort?: { field: string; dir: 'asc' | 'desc' }`;
    - `offset: int ≥ 0` (default 0);
    - `limit: int 1..500` (default 100);
    - `locate?: string`.
  - `Op = 'contains' | 'eq' | 'neq' | 'empty' | 'notEmpty' | 'lt' | 'lte' | 'gt' | 'gte'`.
- **Produces, `layerQuery.ts`:**
  - `type ColumnType = 'text' | 'number' | 'date'`;
  - `interface Column { name: string; type: ColumnType }`;
  - `compileQuery(columns: Column[], body: LayerQueryBody, firstParam: number): { where: string; orderBy: string; params: unknown[] }`.
    - `where` and `orderBy` refer to a row alias `r` with columns `id`, `properties` (jsonb) and `geom`.
    - Placeholders start at `$firstParam`.
  - Throws `ValidationError` with `Trường "<name>" không có trong lớp này.` for an unknown field. It throws `ValidationError` for an operator not allowed on that column's type: text allows `contains`, `eq`, `neq`, `empty` and `notEmpty`; number and date allow `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `empty` and `notEmpty`.
- **The rules the SQL must follow:**
  - The text value is `r.properties ->> $k`, with the key bound.
  - `contains` and the search box compare `workspace.fold_text(value) LIKE '%' || workspace.fold_text($v) || '%'`, with `%`, `_` and `\` in the user value escaped.
  - The search box ORs `contains` over every `text` column.
  - Number comparisons apply only when the value matches `^-?\d+(\.\d+)?$`, then cast to `numeric`. A non-number value is false, never an error.
  - Dates compare as text on `YYYY-MM-DD`.
  - `empty` is `IS NULL OR = ''`.
  - `bbox` is `r.geom && ST_MakeEnvelope($…, 4326)`.
  - `match` joins the conditions with AND or OR. The search and the bbox always AND with the result.
  - `orderBy` is the sort column (numeric-aware for `number`), `NULLS LAST`, then `r.id` for a stable order. With no sort, the order is `r.id`.

- [ ] **Step 1: Write the failing tests** (pure, no database):
  - `an unknown field is refused with the Vietnamese message`;
  - `a number operator on a text column is refused`;
  - `keys with quotes and SQL text are bound, never interpolated`: the SQL text contains neither `a'b` nor `DROP`;
  - `a non-numeric value never matches a number condition and never errors`: the compiled SQL guards the cast with the pattern;
  - `match any joins with OR; search and bbox still AND`;
  - `contains escapes % and _`;
  - `params are numbered from firstParam`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- layerQuery`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): biên dịch bộ lọc bảng đối tượng thành SQL với tham số ràng buộc`

---

### Task 2: The query route, its sources and columns

**Files:**
- Create: `apps/api/src/modules/workspace/layerTable.ts` (the service), `apps/api/src/modules/workspace/layerTable.test.ts`
- Modify:
  - `apps/api/src/modules/layers/repository.ts`: `editCopyQuerySource`, the SQL that names the base table, which stays where the `activeReads` guard allows it;
  - `apps/api/src/modules/workspace/controller.ts` and `routes.ts`;
  - `apps/api/src/modules/workspace/isolation.test.ts`, adding the route to the map-route sweep.

**Interfaces:**
- **Consumes:** Task 1's `compileQuery`, `Column` and `LayerQueryBody`; `assertCanRead`; `workspace.edit_copy_rows`; the layer registry (`getLayer(key).attributeColumns`, `attributeSchema`).
- **Produces:**
  - `POST /api/workspace/maps/:mapId/layers/:layerId/query` → `{ columns: Column[]; total: number; matched: number; rows: { id: string; properties: Record<string, unknown>; bbox: [number, number, number, number] | null }[]; position: number | null }`. `position` is the `locate` feature's zero-based index in the filtered, sorted list, or `null` when filtered out or not asked for.
  - Rate limit `TABLE_QUERY_LIMIT = { rateLimit: { max: 600, timeWindow: '1 minute' } }`.
- **Access:** owner or recipient; a stranger gets the map's 404. A raster layer answers 400 `Loại lớp này chưa hỗ trợ thao tác này.`
- **Columns:**
  - drawn free layer (declared fields): those fields;
  - free layer without declared fields: the distinct keys of its first 5,000 rows by id, at most 200, sorted by name. A key is typed `number` when every non-null value seen is a JSON number, otherwise `text`;
  - edit copy: all of the registry's attribute columns, typed `number` for numeric zod fields and `text` otherwise.
- **The source:** one CTE `r(id, properties, geom)`:
  - free layer: `workspace.features WHERE layer_id = $1`;
  - edit copy: `edit_copy_rows(...)` with no bbox and no limit, geometry turned back into `geom`.
  - `total` counts the source; `matched` counts it after the WHERE; the page is `OFFSET`/`LIMIT` after `orderBy`; `position` comes from `row_number()` over the same order.
- **Timeout:** the whole read runs in one transaction with `SET LOCAL statement_timeout = '5s'`. A timeout (`57014`) answers 400 `Bộ lọc mất quá nhiều thời gian; hãy thu hẹp điều kiện.`

- [ ] **Step 1: Write the failing tests** in `layerTable.test.ts`:
  - `each operator filters a drawn layer, an imported layer and an edit copy`;
  - `the search box ignores diacritics: "dap" finds "Đập"`;
  - `a column with any non-number value is typed text`;
  - `a column named with quotes and spaces filters and sorts`;
  - `total, matched and paging agree`;
  - `locate returns the position, and null when the filter hides the feature`;
  - `rows carry their bbox`;
  - `a recipient may query; a stranger gets the map 404`;
  - `a raster layer is refused`;
  - `a filtered, sorted page of a rivers edit copy returns within 1.5 s` (an edit copy of rivers made through the API; `ten`/`name` contains "a", sorted by name, offset 0, limit 100).
  - In `isolation.test.ts`: the new route in the map-route sweep (stranger and admin 404).
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- layerTable isolation`. Expected: FAIL.
- [ ] **Step 3: Implement** `layerTableService(pg).query(user, mapId, layerId, body)` in `layerTable.ts` and the controller and route. If the timing test fails, stop and report: the spec's fallback (a per-draft snapshot) is a separate decision, not part of this task.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm run test:api` and `npx tsc -p apps/api/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(api): truy vấn bảng đối tượng của lớp cá nhân — lọc, sắp xếp, phân trang, định vị trên máy chủ`

---

### Task 3: Web client, table store and query hook

**Files:**
- Modify: `apps/web/src/features/my-maps/api/workspace.api.ts`, `apps/web/src/features/my-maps/model/queries.ts`
- Create: `apps/web/src/features/my-maps/model/table.store.ts`, `apps/web/src/features/my-maps/model/useTableQuery.ts`, and their tests

**Interfaces:**
- **Produces, `workspace.api.ts`:**
  - `queryLayer(mapId, layerId, body: LayerQueryRequest): Promise<LayerQueryResponse>`;
  - the types mirror Task 2 (`TableColumn { name; type: 'text' | 'number' | 'date' }`, `TableRow { id; properties; bbox }`, `TableCondition { field; op; value? }`).
- **Produces, `table.store.ts`:** a module store like `myMaps.store.ts`.
  - State: `{ open: { mapId: string; layerId: string } | null; byLayer: Record<layerId, TableFilter>; selectedId: string | null }`.
  - `TableFilter = { q: string; conditions: TableCondition[]; match: 'all' | 'any'; inView: boolean; sort: { field: string; dir: 'asc' | 'desc' } | null; page: number }`.
  - Functions:
    - `openTable(mapId, layerId)`: switches the table; keeps that layer's filter for the session;
    - `closeTable()`;
    - `setFilter(patch)`: resets `page` to 0 unless `page` is in the patch;
    - `select(id | null)`;
    - `useTableStore()`;
    - `resetTableStore()`.
- **Produces, `useTableQuery.ts`:** `useTableQuery(viewExtent4326: [number, number, number, number] | null)` returns `{ data: LayerQueryResponse | undefined; loading; error: string | null; refetch }`.
  - **Query key:** `['ws','table', mapId, layerId, debouncedFilter, inView ? extent : null]`.
  - **Debounce:** `q` and condition values are debounced 300 ms.
  - **Keeping rows:** `placeholderData: keepPreviousData`, so the old page stays visible while loading.
  - **Errors:**
    - a 400 shows the API message;
    - a network error shows `Không tải được bảng. Thử lại.`;
    - a 404 on the map calls `dropGoneMap` (existing).
  - `keys.table(mapId, layerId)` is added to `queries.ts`. Every successful map write already invalidates `keys.map`; it also invalidates `['ws','table', mapId]`.

- [ ] **Step 1: Write the failing tests:**
  - store: `opening another layer keeps each layer's filter`, `a filter change resets the page`;
  - hook: `typing quickly sends one query after 300 ms and a late older answer is ignored` (fake timers; a deferred first response resolved after the second);
  - hook: `in view sends the extent; off sends none`;
  - queries: `a map write invalidates its tables`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- my-maps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): lớp gọi truy vấn bảng, kho trạng thái bảng và móc truy vấn có giãn 300 ms`

---

### Task 4: A tidier card: two buttons, a ⋯ menu, *Bảng* on layer rows

**Files:**
- Modify:
  - `apps/web/src/features/my-maps/ui/MapCard.view.tsx`;
  - `ui/LayerRow.view.tsx`;
  - `index.tsx`;
  - `model/useMyMapsPanelPresenter.ts`;
  - their tests;
  - `styles/main.css`.
- Create: `apps/web/src/features/my-maps/ui/CardMenu.view.tsx` and its test.

**Interfaces:**
- **Consumes:** Task 3's `openTable`.
- **Produces:** `CardMenuView({ items: { label: string; onSelect: () => void; danger?: boolean }[] })`.
  - The button is labelled `Thao tác khác` (aria-label) and shows **⋯**.
  - The menu opens below it, closes on Escape, on an outside click and after a choice, and is keyboard reachable (arrow keys move focus).
- **The card:**
  - Header: title, `{n} lớp`, the ⋯ menu. Owner items: `Tải xuống`, `Chia sẻ`, `Đổi tên`, `Xoá bản đồ` (danger). Recipient items: `Tải xuống`, `Tạo bản sao`.
  - Expanded owner card: buttons `Tải tệp lên` and `Thêm lớp` only. `Thêm lớp` still opens `Lớp vẽ mới` / `Sửa một lớp chính thức`.
  - Layer rows: a `Bảng` button on free and edit-copy rows, for both owner and recipient; none on raster rows. It calls `openTable(mapId, layerId)` and expands the map if needed.
  - Removed from the card: `PersonalEditingView`, so *Vẽ thêm* and *Sửa đối tượng* are no longer on the card.

- [ ] **Step 1: Write the failing tests:**
  - `the owner card shows two buttons and the menu holds Tải xuống, Chia sẻ, Đổi tên, Xoá bản đồ`;
  - `a recipient's menu holds Tải xuống and Tạo bản sao only`;
  - `a raster row has no Bảng; Bảng opens that layer's table`;
  - `the menu closes on Escape and on an outside click`;
  - `the card no longer shows Vẽ thêm or Sửa đối tượng`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- my-maps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): thẻ bản đồ gọn — hai nút và menu ⋯; nút Bảng trên từng lớp`

---

### Task 5: The docked table (read-only): toolbar, columns, symbol cell, sort, paging, conditions

**Files:**
- Create in `apps/web/src/features/my-maps/`:
  - `model/useTablePresenter.ts`;
  - `ui/LayerTable.view.tsx`;
  - `ui/ConditionEditor.view.tsx`;
  - tests.
- Modify:
  - `model/personalStyle.ts`: `symbolDataUrl`;
  - `index.tsx`: export `PersonalTable`;
  - `apps/web/src/app/MapScreen.tsx`: mount `<PersonalTable />` at the bottom of the map stage;
  - `styles/main.css`.

**Interfaces:**
- **Consumes:** Tasks 3 and 4; `useMapDetail`; `parseStyle`, `officialStyleFor`; the edit-copy column-name → standard-name step already in `personalStyle.ts`.
- **Produces:**
  - `symbolDataUrl(layer: LayerSummary, properties: Record<string, unknown>, geometryType: 'point' | 'line' | 'polygon'): string`. It draws the feature's style into a 20×16 canvas with `ol/render`'s `toContext`, and returns `canvas.toDataURL()`, cached per layer and style key.
  - `columnLabel(layer: LayerSummary, column: string): string` in `model/columnLabel.ts`. It returns the column name for now; it is the single place the data dictionary will plug in Vietnamese labels (spec T8). Header cells and condition field pickers use it.
  - `useTablePresenter()` returns:
    - `header: { title; total; matched }`;
    - `columns`, `rows` (with `symbol` set);
    - `page: { index; size: 100; from; to; canPrev; canNext }`;
    - `sort`, `filter`, `loading`, `error`, `isOwner`;
    - actions: `setSearch`, `addCondition`, `updateCondition`, `removeCondition`, `setMatch`, `setInView`, `toggleSort(field)` (ascending → descending → off), `prev`, `next`, `close`.
- **The view:**
  - Toolbar:
    - the layer title, `{total} đối tượng · {matched} khớp`, a search box with placeholder `Tìm…`;
    - condition chips (`{field} {opLabel} {value}` with ✕) and `+ Thêm điều kiện`;
    - a match select `Tất cả điều kiện` / `Một trong các điều kiện`, and a `Chỉ trong khung nhìn` checkbox;
    - `Phóng tới` (Task 6) and `Đóng`.
  - Operator labels: `chứa`, `bằng`, `khác`, `trống`, `không trống`, `<`, `≤`, `>`, `≥`.
  - Header cells sort on click and show ▲ or ▼.
  - First column `Ký hiệu`, an `<img alt="">` of the symbol.
  - Paging: `{from}–{to} / {matched}` with `Trước` and `Sau`.
  - Loading keeps the old rows faded. An error shows the message, with `Thử lại` for network errors.
  - The dock is 40 % of the map stage's height and can be resized by dragging its top edge, between 20 % and 70 %.

- [ ] **Step 1: Write the failing tests:**
  - presenter: `columns and rows come from the query; the symbol cell is filled`;
  - presenter: `clicking a header cycles ascending, descending, off`;
  - presenter: `Sau and Trước page by 100 and stop at the ends`;
  - presenter: `conditions offer only the operators of their column's type`;
  - view: `shows the header counts, the chips and the paging line`;
  - `symbolDataUrl`: `returns a data URL and caches per layer and style`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): bảng đối tượng gắn dưới bản đồ — tìm, điều kiện, sắp xếp, phân trang, cột ký hiệu`

---

### Task 6: Selection both ways, the ring, *Phóng tới*, locate

**Files:**
- Modify:
  - `apps/web/src/features/my-maps/model/personalLayers.ts`: `ringFeature` and `clearRing`;
  - `model/useTablePresenter.ts`;
  - `model/usePersonalPopupPresenter.ts`: a click on the table's layer selects instead of opening the card;
  - tests.

**Interfaces:**
- **Consumes:** Task 5; `personalFeatureAt`; `fitToExtent4326`.
- **Produces:**
  - `ringFeature(map, layerId, featureId)`: a yellow ring on the selected feature, drawn on its own overlay layer with id `ws-ring`, `personal: true`, zIndex 996. It stays put through layer reloads, re-applied by id after each load.
  - `clearRing(map)`.
  - The presenter gains `selectRow(id)`, `zoomToSelection()` and `selectedOutsideFilter: boolean`.
- **Behaviour:**
  - **Row click:** `select(id)` and `ringFeature`; the map does not move.
  - **`Phóng tới`:** fits the selected row's `bbox`, or all matched rows' bboxes on the current page when nothing is selected.
  - **Map click:** with the table open, a click whose `personalFeatureAt` hit is on the table's layer selects that feature and closes no card.
    - If the feature isn't on the current page, the table re-queries with `locate` and jumps to `floor(position / 100)`.
    - When `position` is `null`, `selectedOutsideFilter` is true, and the note `Đối tượng này không khớp bộ lọc` shows above the rows.
  - A click on any other layer behaves as before.

- [ ] **Step 1: Write the failing tests:**
  - `a row click selects and rings without moving the map`;
  - `a map click on the table's layer selects its row and opens no card`;
  - `a feature on another page is located and its page shown`;
  - `a feature hidden by the filter shows the note`;
  - `Phóng tới fits the selection's bbox`;
  - `the ring survives a layer reload`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): chọn đối tượng hai chiều giữa bảng và bản đồ, vòng đánh dấu, phóng tới, định vị trang`

---

### Task 7: Editing from the table; removing *Sửa đối tượng*

**Files:**
- Modify:
  - `apps/web/src/features/my-maps/model/usePersonalEditingPresenter.ts`;
  - `index.tsx`;
  - `ui/LayerTable.view.tsx`;
  - `ui/PersonalEditing.view.tsx`;
  - tests.

**Interfaces:**
- **Consumes:** Tasks 5 and 6; the existing editing presenter and forms; `useMapWrite`.
- **Produces:**
  - `usePersonalEditingPresenter` gains `openFeature(layer: LayerSummary, featureId: string, properties: Record<string, unknown>)`, which opens the existing form for that feature without the map-click step, and `startDrawInto(layer)`.
  - The `'select'` step and `startEditMode` are removed, along with *Sửa đối tượng* and its hint.
- **Behaviour:**
  - **The form:** selecting a row opens its form to the right of the rows, inside the dock: `FreeFeatureFormView` or the official form, with `Lưu`, `Huỷ`, `Sửa hình` and `Xoá đối tượng`.
  - **Recipients:** the same form read-only (inputs disabled, no buttons).
  - **`Vẽ thêm`** in the toolbar (owner only) draws into the table's layer. Disabled with the title `Lớp này không vẽ thêm được` for a mixed-geometry imported layer.
  - **After `Lưu`:**
    - the layer reloads on the map and the table refetches its page;
    - the row stays selected;
    - a new feature becomes the selection;
    - a saved feature that no longer matches stays open, with the note.
  - **After `Xoá`:** the selection clears.
  - **Exclusivity:**
    - opening the table or drawing from it calls `closeTool()` when *Biên tập* is open;
    - opening *Biên tập* closes the table's editing;
    - `personalEditing` is set while drawing or reshaping.
  - **The table closes:**
    - when its map is gone (revoked or deleted), with the existing message;
    - when its layer is deleted, with no message;
    - on sign-out.

- [ ] **Step 1: Write the failing tests:**
  - `selecting a row opens its form beside the table`;
  - `a recipient sees the form read-only`;
  - `Vẽ thêm draws into the table's layer and selects the new feature`;
  - `a saved feature that no longer matches stays open with the note`;
  - `deleting clears the selection and refreshes the page`;
  - `opening the table closes Biên tập`;
  - `the table closes when its map is gone or its layer deleted`;
  - `Sửa đối tượng no longer exists`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:web` and `npm run build:web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): sửa đối tượng từ bảng — biểu mẫu cạnh bảng, vẽ thêm vào lớp đang mở; bỏ chế độ Sửa đối tượng`

---

### Task 8: Browser check and full checks

**Files:**
- Modify: `apps/web/scripts/verify-personal-maps.mjs`, `README.md` (one sentence in the personal-maps runbook)

- [ ] **Step 1: Extend the script.** After the GeoJSON import step, at both widths:
  1. **Open the table.** Press the layer's `Bảng`; the dock shows `4 đối tượng · 4 khớp` and the `Ký hiệu` column.
  2. **Filter.** Add the condition `loai_dia_diem` `bằng` the value of one feature; the header says `· 1 khớp`.
  3. **Select from the table.** Click that row; a yellow ring appears where the feature is (pixel check, as for the layer).
  4. **Select from the map.** Clear the filter, click another feature on the map; its row is highlighted.
  5. **Edit.** Change `ten_dia_diem` in the form and press `Lưu`; the row shows the new value.
  6. **The card.** It shows `Tải tệp lên` and `Thêm lớp` only, and the ⋯ menu holds the four owner items.
- [ ] **Step 2: Run** `npm run verify:personal-maps -w @webatlas/web -- --out <scratch dir>` with the stack up. Run it from Git Bash, not PowerShell: PowerShell does not pass `--out` through npm. Expected: every line PASS, with no 429 notes.
- [ ] **Step 3: Run the full checks** from the Global Constraints, with read-only counts of `workspace.maps`, `workspace.files`, `workspace.jobs` and `@webatlas.test` users before and after (equal).
- [ ] **Step 4: Commit** `test(web): kiểm tra trên trình duyệt bảng đối tượng — lọc, chọn hai chiều, sửa từ bảng`
