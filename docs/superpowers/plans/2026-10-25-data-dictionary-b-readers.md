# Data Dictionary, Plan B (Readers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every existing reader of official-layer data shows the dictionary's Vietnamese labels, display units and value names: the personal-layer table (edit copies), its filters, the official feature form, the popups, the legend (and so print), the raster readouts and the assistant's tool results.

**Architecture:**
- **Web:** a new `features/dictionary` module fetches `GET /api/dictionary` once and returns the served dictionary laid over the code defaults (`mergeDictionary`), so readers always have labels, even while loading or offline.
- **Shared:** the helpers from Plan A (`labelFor`, `attributeOf`, `formatValue`, `parseDisplay`, `valueName`) do all conversion. One new helper, `toDisplayInput`, seeds form inputs.
- **API:** the assistant's tools attach labels and units from the database copy, through Plan A's dictionary service.

**Tech Stack:** React 19 + TanStack Query, OpenLayers (only inside `features/map/model/*`), Vitest + Testing Library, Fastify (assistant tools), puppeteer-core for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-24-data-dictionary-design.md` §3 (readers), Plan B row of §6. Plan A (`docs/superpowers/plans/2026-10-24-data-dictionary-a-foundation.md`) is merged to main at `0ca3262`.

## Global Constraints

- **Text:**
  - User-facing copy is Vietnamese, exactly as written in the spec or this plan.
  - Code comments are in English.
  - Commit messages are Vietnamese Conventional Commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Web layout** follows `features/my-maps`:
  - presenters in `model/use*Presenter.ts`, tested with `renderHook`;
  - views in `ui/*.view.tsx` take props only;
  - API functions in `api/`, mocked with `vi.mock`;
  - no web test reaches the network.
- **OpenLayers imports** stay in `features/map/model/*` and the files already allowed in `features/my-maps/model`.
- **`packages/shared/dist` is partly git-tracked.** After changing `packages/shared/src`, build and commit `dist`. New files need `git add -f`.
- **Units:** all conversion goes through the shared helpers; no reader multiplies by a hard-coded factor.
- **The API, exports and the worker stay in stored units** (spec §3.2).
- **No recursive deletes** on this machine.
- **Checks before any claim of completion:** `npm run test:web`, `npm run build:web`, `npm run lint:web`, `npm run test -w @webatlas/shared`, `npm run test:api`, `npx tsc -p apps/api/tsconfig.json --noEmit`, and Task 8's browser check.

## Rulings Beyond the Spec

1. **Web access.**
   - `useDictionary()` returns the code defaults at once and the served copy once it loads.
   - A failed fetch keeps the defaults and shows no error. Labels never fall back to raw names for official layers.
2. **Popups in scope:** the eight editable layers in `components/DynamicPopup.tsx`.
   - The flood-scenario panels (`features/flood-scenario`) and the basemap popups (roads, places, OSM water) keep their own wording for now. They are bespoke dashboards or basemap features, and the dictionary page in Plan C documents them.
   - Their raster readout (flood depth) is in scope (Task 6).
3. **Bespoke popup widgets stay:**
   - the dam status colour badge, the risk badge and the river stream-order names keep their look;
   - only their label text and value text come from the dictionary (`valueName` for the badge text).
4. **Code columns in table conditions** offer the operators `bằng`, `khác`, `trống` and `không trống` (eq, neq, empty, notEmpty), with a value picker listing value names. The stored code is what is sent.
5. **The form never rounds a value the user did not touch.**
   - Inputs are seeded with `toDisplayInput`, which keeps full precision.
   - An untouched number field sends its original stored value.
   - Only an edited field goes through `parseDisplay`.
6. **Print** gets the dictionary through the legend only; it has no attribute display of its own.
7. **Assistant:** tool results carry one `fields` map per layer (`{ [column]: { label, unit? } }`). Values stay in stored units, with the stored unit's symbol, so the model can convert while reporting. The system prompt gains one sentence telling the model to use the labels and display units in answers.

## Review Focus

1. **A value typed in the display unit when it differs from the stored one.** A rivers `length_m` condition typed `12,5` (km) must query 12 500 (m). → Task 2 test `a number condition typed in km queries metres`.
2. **The dictionary fetch fails** (API down, 500). Readers keep the Vietnamese defaults, never raw column names, and no error toast appears. → Task 1 test `a failed fetch keeps the code defaults`.
3. **A stored code missing from the dictionary** (e.g. a dam status added in data before code). It shows as the code itself, never blank, in popup, table cell and form select. → Task 4 test `an unknown status code is shown as the code`; Task 3 test `an unknown code keeps its option in the form select`.
4. **Saving a form without touching a precise value** (`length_m` 12 345,678 m shown in km at precision 1). The stored value must not be rounded to 12 300. → Task 3 test `an untouched number field saves its stored value unchanged`.
5. **Free and imported layers, which have no dictionary entry.** Raw column names and raw values, with no conversion and no error. → Task 2 test `a free layer keeps raw names and values`.

---

### Task 1: Dictionary access in the web, and `toDisplayInput`

**Files:**
- Create: `apps/web/src/features/dictionary/api/dictionary.api.ts`, `apps/web/src/features/dictionary/model/useDictionary.ts`, `apps/web/src/features/dictionary/model/useDictionary.test.tsx`, `apps/web/src/features/dictionary/index.ts`
- Modify: `packages/shared/src/dictionary/format.ts`, `packages/shared/src/dictionary/format.test.ts`

**Interfaces:**
- Produces:
  - `fetchDictionary(): Promise<{ version: string; featureTypes: DictFeatureType[] }>`, through the repo's `apiClient`.
  - `useDictionary(): Dictionary`.
    - TanStack query key `['dictionary']`, `staleTime` 5 minutes, `retry: 1`, `refetchOnWindowFocus: false`.
    - Returns `mergeDictionary(DICTIONARY, data?.featureTypes)`, memoised on `data`.
  - `index.ts` re-exports `useDictionary`.
  - In shared `format.ts`: `toDisplayInput(attribute: DictAttribute, stored: unknown): string`.
    - Missing values (as `formatValue`'s dash cases) → `''`.
    - A `number` with units → converted to the display unit and formatted vi-VN with `maximumFractionDigits: 10` and no grouping, so `parseDisplay` reads it back exactly. No unit symbol.
    - A `number` without units → the same formatting.
    - `code`, `text` and `date` → `String(stored)`.

- [ ] **Step 1: Write the failing tests.**
  - `useDictionary.test.tsx` (mock `dictionary.api`):
    - `returns the code defaults before the fetch resolves` (`labelFor(result, 'dams', 'wattage_mw')` is the default label);
    - `served entries replace the defaults` (a served dams entry with label `X` → `X`);
    - `a failed fetch keeps the code defaults`.
  - `format.test.ts`:
    - `toDisplayInput keeps full precision in the display unit`: `length_m` stored `12345.678`, display `km` → `'12,345678'`; `parseDisplay` of that → `12345.678`;
    - `toDisplayInput gives '' for missing values`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- dictionary` and `npm run test -w @webatlas/shared -- format`. Expected: FAIL.
- [ ] **Step 3: Implement** the API function, the hook, `index.ts` and `toDisplayInput`. Build shared.
- [ ] **Step 4: Run** both commands. Expected: PASS.
- [ ] **Step 5: Commit** (with `dist`) `feat(web): nạp từ điển dữ liệu một lần, mặc định từ mã khi chưa có hoặc lỗi`

---

### Task 2: The table for edit copies, and its filters

**Files:**
- Modify: `apps/web/src/features/my-maps/model/columnLabel.ts`, `useTablePresenter.ts` (and its test), `ui/LayerTable.view.tsx`, `ui/ConditionEditor.view.tsx` (and their tests)

**Interfaces:**
- Consumes: Task 1's `useDictionary`; shared `labelFor`, `attributeOf`, `formatValue`, `parseDisplay`, `valueName`.
- Produces:
  - `columnLabel(layer: LayerSummary, column: string, dictionary: Dictionary): string`. When `layer.kind === 'edit_copy' && layer.layerKey`, it uses `labelFor(dictionary, layer.layerKey, column)`; otherwise it returns `column`.
  - Presenter columns gain `definition?: string`, shown as the header's `title`.
  - `cellText(row, column): string`. On an edit copy it is `formatValue` of the attribute; otherwise it is `String(value ?? '')`.
  - Conditions on an edit copy:
    - For a `number` attribute with a stored unit, the typed value goes through `parseDisplay`. The stored number is sent.
    - An unreadable value shows `parseDisplay`'s message under the editor and sends no query for that condition.
    - A `code` attribute gets `type: 'code'`, the operators of Ruling 4, and `options: { value: code, label: valueName }[]`. The editor renders a `<select>` for it.

- [ ] **Step 1: Write the failing tests** (presenter and view):
  - `an edit copy header shows the dictionary label and its definition on hover` (`wattage_mw` → the dams label);
  - `an edit copy cell shows the display unit` (`length_m` 12500 → `'12,5 km'`);
  - `a number condition typed in km queries metres` (`12,5` → the query body value `12500`);
  - `an unreadable number condition shows the message and sends no query` (`1.5`);
  - `a code column offers value names and sends the code` (dam status: option label from `valueName`, sent `binh_thuong`);
  - `a free layer keeps raw names and values`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- my-maps`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): bảng bản sao chỉnh sửa dùng nhãn, đơn vị và tên giá trị của từ điển`

---

### Task 3: The official feature form

**Files:**
- Modify: `apps/web/src/features/feature-editing/model/useAttributeFormPresenter.ts` (and test), `ui/AttributeField.view.tsx`, `ui/AttributeForm.view.tsx` (and test)

**Interfaces:**
- Consumes: Task 1's `useDictionary` and `toDisplayInput`; shared `labelFor`, `attributeOf`, `parseDisplay`, `valueName`, `unit`.
- Produces:
  - `labels[col]` comes from `labelFor(dictionary, layerKey, col)`, replacing the ISO names from `LAYER_ATTRIBUTE_MAP`.
  - A new `fields[col]: { unitSymbol?: string; options?: { value: string; label: string }[] }`:
    - `unitSymbol` is the display unit's symbol, for number attributes with a unit;
    - `options` lists every listed value of a `code` attribute. If the current value is not listed, its option is added, labelled with the code itself.
  - `AttributeFieldView` gains optional `unitSymbol` (shown as a suffix after the input) and `options` (a `<select>` instead of a text input, plus an empty option `—` when the field is not required).
  - Seeding: `initialValues` (stored values) go through `toDisplayInput`.
  - On submit:
    - an untouched field sends its original stored value (Ruling 5);
    - an edited `number` attribute goes through `parseDisplay`. A refusal goes to `fieldErrors[col]` and nothing is saved.
  - The same presenter serves the edit-copy form, through `save`, so it gets the same behaviour.

- [ ] **Step 1: Write the failing tests:**
  - `form labels come from the dictionary` (dams `wattage_mw` → the dictionary label, not `ratedPower`);
  - `a number field shows its display unit` (lakes `volume_mcm` → suffix `triệu m³`);
  - `an untouched number field saves its stored value unchanged` (rivers `length_m` 12345.678 → sent `12345.678`);
  - `an edited number field is converted back to the stored unit` (length typed `12,5` → sent `12500`);
  - `an unreadable number blocks the save with the field message`;
  - `a code field is a select of value names` (dams `status`);
  - `an unknown code keeps its option in the form select`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- feature-editing`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, plus `npm run test -w @webatlas/web -- my-maps` (the edit-copy form shares the presenter). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): biểu mẫu đối tượng dùng nhãn, đơn vị hiển thị và danh sách giá trị của từ điển`

---

### Task 4: Popups of the eight editable layers

**Files:**
- Modify: `apps/web/src/components/DynamicPopup.tsx` (and `DynamicPopup.test.tsx`)
- Create (if the popup file grows): `apps/web/src/components/popupRows.ts` (pure) with its test

**Interfaces:**
- Consumes: Task 1's `useDictionary`; shared `labelFor`, `attributeOf`, `formatValue`, `valueName`, `LAYER_ATTRIBUTE_MAP` (column → ISO property name, because the popup reads normalised properties).
- Produces:
  - `popupValue(dictionary: Dictionary, layerKey: EditableLayerKey, column: string, props: Record<string, unknown>): string`: reads `props[LAYER_ATTRIBUTE_MAP[layerKey].attributes[column] ?? column]` and returns `formatValue`'s text.
  - `popupLabel(dictionary, layerKey, column): string` = `labelFor`.
  - Every label and value text in the eight editable-layer branches comes from these.
  - The hard-coded unit strings (`MW`, `GWh/năm`, `km²`, `triệu m³`, `km`) and the river length helper go away.
  - The bespoke widgets of Ruling 3 keep their markup and colours.

- [ ] **Step 1: Write the failing tests:**
  - `the dam popup shows dictionary labels and display units` (`wattage_mw` 40 → `'40 MW'` beside the dictionary label);
  - `the lake popup shows volume in triệu m³`;
  - `river length follows the dictionary display unit` (12500 → `'12,5 km'`);
  - `an unknown status code is shown as the code`;
  - `a missing value is not shown` (the existing hide-when-null behaviour is kept).
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- DynamicPopup`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): thẻ đối tượng của tám lớp chính thức dùng nhãn và đơn vị của từ điển`

---

### Task 5: The legend (and so print)

**Files:**
- Modify: `packages/shared/src/legend.ts`, `packages/shared/src/legend.test.ts`, `apps/web/src/features/legend/index.tsx` (and test)

**Interfaces:**
- Consumes: shared `attributeOf`, `formatValue`, `valueName`, `DICTIONARY`.
- Produces: `legendFor(layerStateId: string, dictionary: Dictionary = DICTIONARY): LegendSection[]`.
  - The dam size classes format their thresholds (200 and 1000 MW) with `formatValue` of `dams.wattage_mw`, keeping the words: `Nhỏ (< 200 MW)`, `Vừa (200 – 1000 MW)`, `Lớn (> 1000 MW)` when the display unit is MW.
  - Dam status entries take their label from `valueName(dams.status, slug)`.
  - The legend feature passes `useDictionary()`.

- [ ] **Step 1: Write the failing tests:**
  - shared: `dam size classes follow the wattage display unit` (a test dictionary with display unit `kW` → `Nhỏ (< 200.000 kW)`); `dam status entries use the dictionary value names`; `the default dictionary keeps today's labels`;
  - web: `the legend uses the served dictionary` (mock `useDictionary`).
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- legend` and `npm run test -w @webatlas/web -- legend`. Expected: FAIL.
- [ ] **Step 3: Implement.** Build shared.
- [ ] **Step 4: Run** both commands, plus `npm run test -w @webatlas/web -- print` (print renders the legend). Expected: PASS.
- [ ] **Step 5: Commit** (with `dist`) `feat(shared): chú giải định dạng ngưỡng và tên trạng thái theo từ điển`

---

### Task 6: Raster readouts

**Files:**
- Modify: `apps/web/src/features/map/ui/CursorElevation.tsx`, `apps/web/src/features/analysis/ui/ProfileChart.view.tsx`, the zonal-elevation result in `apps/web/src/features/analysis/ui/AnalysisParams.view.tsx` or `AnalysisButtons.view.tsx` (whichever renders it), `apps/web/src/features/flood-scenario/model/depthColour.ts`, `depthHover.ts`, and their tests

**Interfaces:**
- Consumes: Task 1's `useDictionary`; shared `attributeOf`, `formatValue`.
- Produces:
  - Every elevation value shown to the reader is `formatValue(attributeOf(dictionary, 'dem', '1')!, metres)`. This covers the cursor readout, the profile chart's axis and tooltip, and the zonal min, mean and max.
  - `formatDepth(m: number, attribute: DictAttribute): string` keeps the cap: `≥ 4 m`, written in the display unit (`≥ 400 cm` when it is cm). Otherwise it returns `formatValue(attribute, m)`.
  - Views take the formatted strings or the attribute as props. Presenters or containers read `useDictionary()`.

- [ ] **Step 1: Write the failing tests:**
  - `the cursor elevation uses the dem display unit`;
  - `the profile axis and tooltip use the dem display unit`;
  - `zonal elevation figures use the dem display unit`;
  - `flood depth uses the band display unit and keeps the 4 m cap` (cm test dictionary → `'≥ 400 cm'`).
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- analysis map flood-scenario`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): số đọc độ cao và độ sâu ngập theo đơn vị hiển thị của từ điển`

---

### Task 7: The assistant's tool results

**Files:**
- Modify: `apps/api/src/modules/assistant/tools/data/helpers.ts` and the data tools that return feature properties or elevations (`resolveFeature` users, `featuresInView`, `featuresInAdminUnit`, `filterByAttribute`, `nearestFeatures`, `relatedFeatures`, `selectWithin`, `elevationAtPoint`, `elevationProfile`, `zonalElevation`), `apps/api/src/modules/assistant/prompt.ts`, and their tests
- Create: `apps/api/src/modules/assistant/tools/data/fieldLabels.ts`, `fieldLabels.test.ts`

**Interfaces:**
- Consumes: Plan A's dictionary service (`apps/api/src/modules/dictionary/service.ts`, the served feature types from the database). If it throws, `DICTIONARY` from shared is used instead.
- Produces:
  - `fieldsFor(dictionary: Dictionary, layerKey: string, columns: string[]): Record<string, { label: string; unit?: string }>`. `unit` is the stored unit's symbol, because values stay stored.
  - `loadDictionary(pg: Pool): Promise<Dictionary>`, cached per process for 60 s.
  - Tool results that carry feature properties add `fields` once per layer. Elevation results add `unit: 'm'` from the dem band's stored unit.
  - `prompt.ts` adds one sentence (Vietnamese, as the rest of the prompt): *Khi trả lời, dùng nhãn trong `fields` thay cho tên cột và đổi giá trị sang đơn vị thông dụng nếu cần.*

- [ ] **Step 1: Write the failing tests:**
  - `fieldLabels.test.ts`: `fields carry the label and stored unit symbol` (lakes `volume_mcm` → `{ label: <dictionary label>, unit: 'triệu m³' }`); `columns without an entry are omitted`; `loadDictionary falls back to the code copy when the query fails`;
  - one existing tool test per tool family gains an assertion that `fields` (or `unit`) is present.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- assistant`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, plus `npx tsc -p apps/api/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): kết quả công cụ trợ lý kèm nhãn và đơn vị của từ điển`

---

### Task 8: Browser check and full checks

**Files:**
- Create: `apps/web/scripts/verify-dictionary.mjs` (modelled on `verify-personal-maps.mjs`: the same sign-in, `--out`, PASS/FAIL lines, cleanup through the API)
- Modify: `apps/web/package.json` (script `verify:dictionary`), `README.md` (one sentence beside the personal-maps check)

- [ ] **Step 1: Write the script.** It runs at 1440×900 and 768×900, as an owner account taken from the environment (`VERIFY_OWNER_EMAIL` / `VERIFY_OWNER_PASSWORD`):
  1. **Edit copy.** Create a temporary map and add an edit copy of `dams`. Open its table. A header reads the dictionary label of `wattage_mw`, and a cell ends in ` MW`.
  2. **Filter in display units.** Add a condition on that column with `bằng` and a value of one row in vi-VN form. The header says `· 1 khớp`.
  3. **Code filter.** A condition on `status` offers the value names from the dictionary.
  4. **Form.** Select a row. The form shows the same label, and an input with a unit suffix.
  5. **Legend.** Switch on the dams layer. The legend shows `Nhỏ (< 200 MW)`.
  6. **Cleanup.** Delete the temporary map through the API.
- [ ] **Step 2: Run** `npm run verify:dictionary -w @webatlas/web -- --out <scratch dir>` from Git Bash, with the stack up. Expected: every line PASS.
- [ ] **Step 3: Run the full checks** from the Global Constraints, with read-only counts of `workspace.maps` and `@webatlas.test` users before and after (equal).
- [ ] **Step 4: Commit** `test(web): kiểm tra trên trình duyệt nhãn và đơn vị của từ điển dữ liệu`
