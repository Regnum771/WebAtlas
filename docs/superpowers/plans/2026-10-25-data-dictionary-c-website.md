# Data Dictionary, Plan C (Website) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readers find the dictionary on the site (an ⓘ quick sheet on layer rows, `/du-lieu` and `/du-lieu/:lớp`, a link from the upload dialog), and staff with *quản lý từ điển dữ liệu* edit it at `/quan-ly/tu-dien`, with restore and history.

**Architecture:**
- **Web:** new pages under `apps/web/src/pages/du-lieu/` and `apps/web/src/pages/quan-ly/sections/TuDien.tsx`, rendered as siblings of the map, like `/quan-ly`. Feature code lives in `apps/web/src/features/dictionary/`.
- **API:** the edit routes live in Plan A's `apps/api/src/modules/dictionary/`. They write the field, its `origin`, a `revision` bump and a history row in one transaction, and the permission is checked with `assertCan(user, 'dictionary.manage', 'VN', tree)`.
- **Sync:** it learns one new rule, that a staff-corrected stored unit is kept while it shares the code unit's dimension.

**Tech Stack:** React 19, React Router, TanStack Query, Vitest + Testing Library, Fastify 5, zod, pg, node-pg-migrate, puppeteer-core.

**Spec:** `docs/superpowers/specs/2026-10-24-data-dictionary-design.md` §2.2–§2.4, §4 and the Plan C row of §6. Plans A (merged, `0ca3262`) and B (branch `feat/data-dictionary-b`, head `00b4596`, not yet merged) come first. This plan's branch `feat/data-dictionary-c` is cut from Plan B.

## Global Constraints

- **Text:**
  - User-facing copy is Vietnamese, exactly as written in the spec or this plan.
  - Code comments are in English.
  - Commit messages are Vietnamese Conventional Commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Web layout:**
  - presenters in `model/use*Presenter.ts`, tested with `renderHook`;
  - views `ui/*.view.tsx` take props only;
  - API functions in `api/`, mocked with `vi.mock`;
  - no web test reaches the network.
- **Pages stay siblings of the map** (`MapScreen` never unmounts), as `/quan-ly` does. Heavy pages are lazy-loaded.
- **Gates in the web are UX only.** The API enforces every rule.
- **The permission** is `dictionary.manage`, counted only when the group's jurisdiction includes `VN`. Admins pass.
- **SQL safety:** column names come from fixed maps; every value is bound.
- **API test hygiene:**
  - suites create and delete their own users (`dd-<suite>-<who>@webatlas.test`);
  - roll back before release;
  - fewer than 80 requests per address per minute per file;
  - never delete users by a broad pattern.
- **`packages/shared/dist` is partly git-tracked.** Build and commit `dist` after shared changes. New files need `git add -f`.
- **No recursive deletes** on this machine.
- **Checks before any claim of completion:** `npm run test:web`, `npm run build:web`, `npm run lint:web`, `npm run test -w @webatlas/shared`, `npm run test:api`, `npx tsc -p apps/api/tsconfig.json --noEmit`, and Task 9's browser check.

## Rulings Beyond the Spec

1. **The top bar gains *Dữ liệu*** (`/du-lieu`), visible to everyone, after *Bản đồ*. This is the redesign's planned section.
2. **ⓘ appears only on layer rows that have a dictionary entry.** A web map `LAYER_DICTIONARY_KEYS` (layersState id → dictionary key) decides it:
   - the eight editable layers come from `LAYER_ATTRIBUTE_MAP[key].layerStateId`;
   - the others are listed explicitly (provinces, wards, contours, OSM water, DEM if it has a row).
3. **Edit routes beyond the spec's §2.4 list:**
   - `PATCH /api/dictionary/:layer` edits feature-type fields (name, definition, geometry meaning, `validTo`);
   - `POST /api/dictionary/:layer/:attribute/values` adds a code to an open list;
   - `PATCH /api/dictionary/:layer/:attribute/values/:code` edits a value's name, definition, colour hint and `retired`;
   - `POST /api/dictionary/:layer/:attribute/stored-unit/preview` returns five real values before and after.
4. **Staff-added codes** are trimmed, non-empty text of at most 100 characters (Plan A Ruling 1). The row gets origin key `code`, plus origin entries for `name` and `definition`, so a later code default never overwrites the staff wording (Plan A Task 6 carry-over).
5. **Value type of extra keys** (spec §2.2) has nothing to edit until P5 publishes extra attributes. The API refuses `valueType` edits with *Chỉ đổi được kiểu của thuộc tính bổ sung.*, and the UI shows the type greyed out.
6. **Stored-unit correction:**
   - Migration 33 adds `app.dictionary_unit_periods(feature_type, attribute, stored_unit, valid_from)`, which records each stored unit and the date it applies from.
   - The sync keeps a staff-corrected stored unit while it shares the code unit's dimension, and reverts it otherwise, with a history row.
   - Readers use the current stored unit. The periods are kept for later readers of past data versions.
7. **History rows written by the browser check stay,** since history is an audit trail. The check restores every field it edits, so the dictionary itself ends unchanged.
8. **Typed values are read in the unit shown when typing began** (Plan B prerequisite). The form field and the table condition remember the attribute (unit and precision) from their first keystroke, and parse with that until the field is saved or the condition is closed.
9. **The CF standard name is checked for form only** (`^[a-z][a-z0-9_]*$`), not against the CF table as spec §2.2 says. Bundling the table (about 4,000 names, updated often) is out of proportion to a descriptive field. A later plan can add it.

## Review Focus

1. **Two staff edit the same attribute.** The second save gets 409 *Mục này vừa được người khác sửa.*, the form reloads the current entry, and nothing is lost silently. → Task 5 test `a stale revision is refused with the Vietnamese message`; Task 7 test `a 409 reloads the entry and shows the message`.
2. **A provincial group holding `dictionary.manage`.** Its members cannot edit (403) and do not see the Quản lý entry for the dictionary. → Task 5 test `dictionary.manage on a province does not allow edits`; Task 7 test `the tab is hidden without dictionary.manage on VN`.
3. **A display unit chosen outside the permitted list, or of another dimension, sent by a crafted request.** Refused 400, nothing written. → Task 5 test `a display unit outside the permitted list is refused`.
4. **Restoring a field a later code change already altered.** Restore takes the CURRENT code default, not the value from when it was edited. → Task 5 test `restore takes the current code default`.
5. **A layer page for an unknown or retired layer.** Unknown → *Không có lớp này trong từ điển dữ liệu.* with a link back to `/du-lieu`. Retired → shown with *Đã ngừng dùng từ <date>* and no template buttons. → Task 4 tests `an unknown layer shows the not-found message` and `a retired layer shows its end date and no templates`.

---

### Task 1: Typed values keep the unit they were typed in

**Files:**
- Modify: `apps/web/src/features/feature-editing/model/useAttributeFormPresenter.ts` (and test), `apps/web/src/features/my-maps/model/useTablePresenter.ts` / `useTableQuery.ts` (and tests)

**Interfaces:**
- Produces:
  - The form keeps `typedWith[col]: DictAttribute`, captured at the first edit of that field. `parseDisplay` uses it on submit; untouched fields are unchanged (Plan B Ruling 5).
  - A table condition keeps `typedWith: DictAttribute`, captured when its value is first typed. Conversion and tolerance use it until the condition is removed or its field changes.

- [ ] **Step 1: Write the failing tests:**
  - `a number typed before the served dictionary arrives is read in the unit it was typed in` (form: defaults km, served m; typed `12,5` → sent 12500);
  - `a table condition keeps the unit it was typed in` (same switch; the query value stays 12500 and the tolerance 50).
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- feature-editing my-maps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(web): giá trị đang gõ giữ đơn vị lúc bắt đầu gõ khi từ điển thay đổi`

---

### Task 2: The ⓘ quick sheet on layer rows

**Files:**
- Create: `apps/web/src/features/dictionary/model/layerKeys.ts` (and test), `model/useDictionarySheetPresenter.ts` (and test), `ui/DictionarySheet.view.tsx` (and test)
- Modify: `apps/web/src/features/layers-panel/ui/LayersPanel.view.tsx` (and its container / test), `apps/web/src/styles/main.css`

**Interfaces:**
- Produces:
  - `LAYER_DICTIONARY_KEYS: Readonly<Record<string, string>>` and `dictionaryKeyFor(layerId: string): string | null`.
  - A layer row with a key gets an ⓘ button, `aria-label="Thuộc tính của <tên lớp>"`, that opens the sheet beside the panel. Only one sheet is open at a time; Escape and *Đóng* close it.
  - The sheet:
    - title `<tên lớp> — thuộc tính`;
    - per current attribute, in `ord` order: the label, the display-unit symbol if any, the one-line definition, and `<n> giá trị` for code attributes;
    - a link *Xem đầy đủ →* to `/du-lieu/<key>`.
  - Retired attributes are left out.

- [ ] **Step 1: Write the failing tests:**
  - `every editable layer row maps to its dictionary key`;
  - `a row without an entry has no ⓘ`;
  - `the sheet lists label, unit, definition and value count in order`;
  - `Xem đầy đủ links to the layer page`;
  - `Escape closes the sheet and returns focus to the ⓘ`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- dictionary layers-panel`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): nút ⓘ trên dòng lớp mở bảng thuộc tính tóm tắt`

---

### Task 3: `/du-lieu` and the top-bar entry

**Files:**
- Create: `apps/web/src/pages/du-lieu/index.tsx` (the list), `apps/web/src/features/dictionary/model/useDictionaryListPresenter.ts` (and test), `ui/DictionaryList.view.tsx` (and test)
- Modify: `apps/web/src/app/App.tsx` (lazy routes `/du-lieu` and `/du-lieu/:key`), `apps/web/src/widgets/top-bar/model/nav.ts` (and test)

**Interfaces:**
- Produces:
  - `/du-lieu` lists the current feature types in two groups, *Lớp vectơ* and *Lớp ảnh*. Each row shows the name and a one-line definition and links to `/du-lieu/<key>`.
  - A search box (`aria-label="Tìm lớp"`) filters on name and definition, accent-insensitive (shared fold of diacritics, as elsewhere in the web).
  - No match shows *Không có lớp nào khớp.*
  - The page has a close control back to the map (*Về bản đồ*).
  - The top bar shows *Dữ liệu* for everyone (Ruling 1).

- [ ] **Step 1: Write the failing tests:**
  - `the list groups vector and raster layers`;
  - `search ignores diacritics` (`dap` finds `Đập`);
  - `no match shows the empty message`;
  - `the top bar shows Dữ liệu to everyone`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- dictionary top-bar App`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): trang Dữ liệu liệt kê các lớp trong từ điển`

---

### Task 4: `/du-lieu/:lớp`, templates and the upload-dialog link

**Files:**
- Create: `apps/web/src/pages/du-lieu/LayerPage.tsx`, `apps/web/src/features/dictionary/model/useLayerPagePresenter.ts` (and test), `ui/LayerPage.view.tsx` (and test)
- Modify: `apps/web/src/features/my-maps/ui/UploadDialog.view.tsx` (and test), `apps/web/src/styles/main.css` (including `@media print`)

**Interfaces:**
- Consumes: `GET /api/dictionary/:layer` (Plan A), the template URLs, shared `unit`, `commonConversions`, `valueName`.
- Produces:
  - **Header:** name, kind (*Lớp vectơ* / *Lớp ảnh*), geometry type and what it stands for (*chính xác* / *gần đúng* / *điểm đại diện*), `EPSG:<crs>`, and *Hiệu lực từ <validFrom>*.
  - **The attribute table**, columns *Thuộc tính · Ý nghĩa · Kiểu · Đơn vị (lưu → hiển thị) · Quy đổi thông dụng · Giá trị · Tên chuẩn CF*:
    - *Kiểu* is *chữ*, *số*, *ngày* or *mã*;
    - units show their symbols;
    - *Quy đổi thông dụng* lists `1 <display> = <factor> <other>` from `commonConversions` (vi-VN numbers);
    - *Giá trị* shows `<n> giá trị` with a disclosure that lists code → name (retired ones marked *ngừng dùng*).
  - **Templates:** for a vector layer, *Tải mẫu GeoPackage* and *Tải mẫu CSV* link to `${API_BASE}/api/dictionary/<key>/template.gpkg|.csv`.
  - **Unknown layer** → *Không có lớp này trong từ điển dữ liệu.* with a link to `/du-lieu`.
  - **Retired layer** → *Đã ngừng dùng từ <validTo>* and no template buttons.
  - **Print:** the page prints without the map, top bar or buttons.
  - **The upload dialog** gets a link *Cấu trúc các lớp chính thức →* to `/du-lieu`.

- [ ] **Step 1: Write the failing tests:**
  - `the header shows kind, geometry meaning, EPSG and valid-from`;
  - `the table shows stored → display units and common conversions` (lakes `volume_mcm`);
  - `code values expand and mark retired ones`;
  - `vector layers offer both templates and rasters none`;
  - `an unknown layer shows the not-found message`;
  - `a retired layer shows its end date and no templates`;
  - `the upload dialog links to the layer structures`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- dictionary my-maps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): trang thuộc tính của từng lớp với quy đổi đơn vị và tệp mẫu`

---

### Task 5: Edit API — layer and attribute fields, restore, history

**Files:**
- Create: `apps/api/src/modules/dictionary/edit.ts` (service), `edit.test.ts`, `editSchemas.ts`
- Modify: `apps/api/src/modules/dictionary/routes.ts`, `controller.ts`

**Interfaces:**
- Produces:
  - **Routes**, all requiring authentication plus `dictionary.manage` on `VN` (admin passes):
    - `PATCH /api/dictionary/:layer`, body `{ expectedRevision: number; name?; definition?; geometryMeaning?; validTo?: string | null }`;
    - `PATCH /api/dictionary/:layer/:attribute`, body `{ expectedRevision: number; label?; definition?; displayUnits?: string[]; displayUnit?; precision?; cfStandardName?: string | null; validTo?: string | null; valueType? }`;
    - `POST /api/dictionary/:layer/restore` and `POST /api/dictionary/:layer/:attribute/restore`, body `{ fields: string[] }`;
    - `GET /api/dictionary/history?layer=&attribute=&limit=`, newest first, `limit` ≤ 200 (default 50).
  - Each answer is the updated entry, in Plan A's served shape plus `revision`.
  - **Rules** (spec §2.2), refused with 400 and a Vietnamese message naming the field:
    - `displayUnits` ⊆ units of the stored unit's dimension, and `displayUnit ∈ displayUnits`;
    - `precision` is an integer from 0 to 6;
    - `cfStandardName` matches `^[a-z][a-z0-9_]*$` (Ruling 9);
    - `geometryMeaning` is one of the three values;
    - `validTo` is a `YYYY-MM-DD` date ≥ `validFrom`, or null to un-retire;
    - locked fields are refused with *Trường "<label>" theo cấu trúc dữ liệu, không sửa được.*;
    - `valueType` is refused per Ruling 5.
  - **A write** sets the field, sets `origin[field] = { by: userId, at: now }`, bumps `revision` and inserts history (`reason 'edit'`, old → new), in one transaction.
  - **A stale `expectedRevision`** → 409 `{ error: { code: 'DICTIONARY_CHANGED', message: 'Mục này vừa được người khác sửa.' } }`.
  - **Restore** removes the origin keys, writes the CURRENT code default (shared `DICTIONARY`), bumps `revision` and writes history (`reason 'restore'`).
  - **Permission:** without `dictionary.manage` on VN → 403, in the repo's existing refusal format.

- [ ] **Step 1: Write the failing tests:**
  - `an admin edits a label and history records it`;
  - `dictionary.manage on VN allows edits`;
  - `dictionary.manage on a province does not allow edits`;
  - `a stale revision is refused with the Vietnamese message`;
  - `a display unit outside the permitted list is refused`;
  - `a locked field is refused`;
  - `restore takes the current code default`;
  - `history lists edits newest first`;
  - `the sync keeps an edited label` (run `runSync` after an edit; the label survives).
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- dictionary/edit`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, plus `npm run test -w @webatlas/api -- dictionary` and `npx tsc -p apps/api/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): sửa, khôi phục và lịch sử từ điển dữ liệu cho người có quyền`

---

### Task 6: Edit API — listed values and the stored-unit correction

**Files:**
- Create: `apps/api/src/db/migrations/1000000000033_dictionary-unit-periods.cjs`, `apps/api/src/modules/dictionary/storedUnit.ts`, `storedUnit.test.ts`, `values.test.ts`
- Modify: `edit.ts`, `routes.ts`, `controller.ts`, `syncPlan.ts` (and test)

**Interfaces:**
- Produces:
  - **`POST /api/dictionary/:layer/:attribute/values`**, `{ expectedRevision, code, name, definition? }`:
    - open lists only; a closed list → 400 *Danh sách giá trị này theo cấu trúc dữ liệu, không thêm được.*;
    - `code` is trimmed, 1–100 characters, and must not already be present;
    - the row's origin gets `code`, `name` and `definition` (Ruling 4);
    - the attribute's `revision` is bumped.
  - **`PATCH /api/dictionary/:layer/:attribute/values/:code`**, `{ expectedRevision, name?, definition?, colorHint?: string | null, retired? }`. `retired` is refused on a closed list. `colorHint` matches `^#[0-9a-fA-F]{6}$`.
  - **`POST .../stored-unit/preview`**, `{ storedUnit }` → `{ rows: { id, stored, before, after }[] }`:
    - up to five non-null values of the column from the layer's active rows (the table from the entry, read through a fixed map, never interpolated from input);
    - `before` and `after` are `formatValue` strings under the current and the proposed stored unit;
    - another dimension → 400.
  - **`PATCH /api/dictionary/:layer/:attribute`** accepts `{ storedUnit, storedUnitValidFrom: 'YYYY-MM-DD' }` together:
    - same dimension only;
    - writes `app.dictionary_unit_periods`, sets `stored_unit`, sets the origin, bumps the revision and writes history;
    - `displayUnits` and `displayUnit` stay valid because the dimension is unchanged.
  - **Migration 33:** `app.dictionary_unit_periods(feature_type text, attribute text, stored_unit text NOT NULL, valid_from date NOT NULL, created_by uuid NULL REFERENCES app.users ON DELETE SET NULL, created_at timestamptz DEFAULT now(), PRIMARY KEY (feature_type, attribute, valid_from), FOREIGN KEY (feature_type, attribute) REFERENCES app.dictionary_attributes ON DELETE RESTRICT)`. No grant to the assistant role.
  - **Sync:** an edited `storedUnit` is kept while `sameDimension(edited, code)`, and reverted (`sync_revert`) otherwise. This replaces "storedUnit always locked" in `syncPlan.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `a code can be added to an open list and keeps its staff wording through a sync`;
  - `adding to a closed list is refused`;
  - `retiring on a closed list is refused`;
  - `the preview shows five real values before and after`;
  - `a stored-unit correction of another dimension is refused`;
  - `a stored-unit correction writes its period and survives a sync`;
  - planner: `an edited stored unit of the same dimension is kept; of another dimension is reverted`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- dictionary`. Expected: FAIL.
- [ ] **Step 3: Write the migration** and run `npm run migrate:up -w @webatlas/api`. **Implement** the routes and the sync change.
- [ ] **Step 4: Run** the same command, `npx tsc -p apps/api/tsconfig.json --noEmit`, and `npm run migrate:down -w @webatlas/api && npm run migrate:up -w @webatlas/api`. Then run `npm run dictionary:sync -w @webatlas/api`. Expected: PASS; the down/up round-trip is clean; the sync prints all zeros.
- [ ] **Step 5: Commit** `feat(api): thêm và sửa giá trị của danh sách mở, hiệu chỉnh đơn vị lưu có ngày hiệu lực`

---

### Task 7: `/quan-ly/tu-dien` — list, edit form, restore, history

**Files:**
- Create: `apps/web/src/pages/quan-ly/sections/TuDien.tsx`, `apps/web/src/features/dictionary/api/dictionaryEdit.api.ts`, `model/useDictionaryEditorPresenter.ts` (and test), `ui/DictionaryEditor.view.tsx`, `ui/DictionaryHistory.view.tsx` (and tests)
- Modify: `apps/web/src/pages/quan-ly/index.tsx`, `pages/quan-ly/model/visibility.ts` (and tests), `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: Task 5's routes, `useDictionary`, `useCan`.
- Produces:
  - **Visibility:** `canSeeTuDien(user, can) = user?.isAdmin || can('dictionary.manage', COUNTRY_UNIT)`. The *Từ điển dữ liệu* item appears in the Quản lý nav, and `canSeeQuanLy` includes it.
  - **The section:**
    - a layer picker and the attribute list of the chosen layer;
    - selecting an attribute opens a form with label, definition, display unit (a select of permitted units), permitted display units (checkboxes of the dimension's units, from shared `unitsOfDimension`), precision (0–6), CF name, retire/un-retire with a date, and *Lưu*;
    - locked fields show read-only with the hint *theo cấu trúc dữ liệu*;
    - an edited field shows *Đã sửa bởi <tên> lúc <thời gian>* and a per-field *Khôi phục mặc định*, and the form has *Khôi phục tất cả*;
    - a feature-type form (name, definition, geometry meaning, retire) sits above the list;
    - a history panel lists who, when, field, old → new and reason (*sửa*, *khôi phục*, *đồng bộ hoàn nguyên*, *đồng bộ ngừng dùng*).
  - **After saves:**
    - a successful save invalidates `['dictionary']`, so readers update;
    - a 409 shows *Mục này vừa được người khác sửa.* and reloads the entry;
    - a 400 shows the API message under its field.

- [ ] **Step 1: Write the failing tests:**
  - `the tab is hidden without dictionary.manage on VN`;
  - `an admin sees the tab`;
  - `locked fields are read-only with the structure hint`;
  - `saving a label sends the expected revision and refreshes the dictionary`;
  - `a 409 reloads the entry and shows the message`;
  - `restore sends the field and shows the default again`;
  - `history shows reasons in Vietnamese`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- dictionary quan-ly`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): mục Từ điển dữ liệu trong Quản lý — sửa, khôi phục, lịch sử`

---

### Task 8: `/quan-ly/tu-dien` — listed values and stored-unit correction

**Files:**
- Create: `apps/web/src/features/dictionary/ui/ValueListEditor.view.tsx`, `ui/StoredUnitDialog.view.tsx` (and tests)
- Modify: `useDictionaryEditorPresenter.ts` (and test), `dictionaryEdit.api.ts`, `ui/DictionaryEditor.view.tsx`

**Interfaces:**
- Consumes: Task 6's routes.
- Produces:
  - **Code attributes** show their values with name, definition, colour hint and retire controls.
    - Open lists get *Thêm giá trị* (code + name + definition).
    - Closed lists show values read-only, apart from name, definition and colour, with *theo cấu trúc dữ liệu* on code and retire.
  - **Number attributes with a stored unit** get *Hiệu chỉnh đơn vị lưu…*, which opens a dialog:
    - a unit select limited to the same dimension;
    - *Xem trước* shows the five rows of the preview (`stored`, `before` → `after`);
    - a required *Áp dụng từ ngày* date;
    - a confirmation checkbox *Tôi hiểu việc này chỉ sửa cách hiểu số liệu, không đổi số liệu.*;
    - *Áp dụng* is disabled until all three are set.

- [ ] **Step 1: Write the failing tests:**
  - `an open list can add a value`;
  - `a closed list's codes cannot be added or retired`;
  - `the stored-unit dialog needs a preview, a date and the confirmation`;
  - `the stored-unit dialog offers only units of the same dimension`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- dictionary`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): sửa danh sách giá trị và hiệu chỉnh đơn vị lưu trong Quản lý`

---

### Task 9: Browser check and full checks

**Files:**
- Modify: `apps/web/scripts/verify-dictionary.mjs`, `README.md` (the dictionary paragraph)

- [ ] **Step 1: Extend the script.** At both widths, with a temporary admin from the environment (`VERIFY_OWNER_*`; an admin passes `dictionary.manage`):
  1. **Sheet.** Press the ⓘ on the dams row. The sheet lists the `wattage_mw` label with `MW`. *Xem đầy đủ* opens `/du-lieu/dams`.
  2. **Layer page.** It shows `EPSG:4326` and the two template buttons. The CSV template URL answers 200.
  3. **List.** `/du-lieu` search `dap` finds the dams layer.
  4. **Staff edit.** In `/quan-ly/tu-dien`, change the `wattage_mw` label to `<label> (kiểm thử)` and save. The new label appears in a dam popup's row (open it through the table's row of an edit copy, or by a known dam's feature card) and in the edit-copy table header.
  5. **Restore.** *Khôi phục mặc định* brings the label back. The history panel lists both rows.
  6. **Cleanup.** The temporary map is deleted, and the label is back to its default (checked through `GET /api/dictionary/dams`).
- [ ] **Step 2: Run** `npm run verify:dictionary -w @webatlas/web -- --out <scratch dir>` from Git Bash, with the stack up, and not alongside `npm run test:api` (that suite deletes every `@webatlas.test` user). Expected: every line PASS.
- [ ] **Step 3: Run the full checks** from the Global Constraints, with read-only counts of `workspace.maps` and `@webatlas.test` users before and after (equal).
- [ ] **Step 4: Commit** `test(web): kiểm tra trên trình duyệt trang Dữ liệu và mục Từ điển dữ liệu`
