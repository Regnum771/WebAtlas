# Data Dictionary, Plan A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One typed data dictionary for the official layers in `packages/shared`, a full copy of it in the database kept in step by a sync command, a public read API with empty upload templates, and the `dictionary.manage` permission. Readers (Plan B) and the website and editing (Plan C) come later.

**Architecture:**
- `packages/shared/src/dictionary/` holds the unit table, the types, the pure helpers and the entries, one file per layer.
- Migration 32 creates four `app.dictionary_*` tables and widens the permission constraint.
- `apps/api/src/modules/dictionary/` holds:
  - the sync: a pure planner plus a database applier, run by `npm run dictionary:sync` and by `atlas:up`;
  - the read routes;
  - the template writers.
- The database copy is what the API serves. The code copy holds the defaults.

**Tech Stack:** TypeScript (ESM), Vitest, Fastify 5, zod, pg, node-pg-migrate (`.cjs` migrations), PostGIS. Node 22.13's built-in `node:sqlite` writes the GeoPackage template.

**Spec:** `docs/superpowers/specs/2026-10-24-data-dictionary-design.md` (approved by the user 2026-10-24, with its five assumptions). This plan covers the spec's Plan A row in §6.

## Global Constraints

- **Text:**
  - User-facing copy is Vietnamese, exactly as written in the spec or this plan.
  - Code comments are in English.
  - Commit messages are Vietnamese Conventional Commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **`packages/shared/dist` is partly git-tracked.**
  - After changing `packages/shared/src`, run `npm run build -w @webatlas/shared` and commit the regenerated `dist`.
  - New files need `git add -f packages/shared/dist/<path>.js packages/shared/dist/<path>.d.ts`, because a blanket `dist` ignore rule silently skips them.
  - Check with `git status --ignored packages/shared/dist`.
- **ESM imports** inside `packages/shared/src` end in `.js` (see the comment in `index.ts`).
- **Migrations create tables; the sync populates them.** No migration inserts dictionary content.
- **Grants:** every new relation the assistant may read gets `GRANT SELECT … TO webatlas_assistant` in its migration.
- **API test hygiene:**
  - each suite creates and deletes its own users (`dd-<suite>-<who>@webatlas.test`);
  - roll back before release;
  - fewer than 80 requests per address per minute per file.
  - Never delete users by a broad pattern.
- **No recursive deletes** on this machine, in code, tests or scripts.
- **Units:** conversions are always computed from the unit table, and converting between different dimensions throws.
- **Checks before any claim of completion:** `npm run test -w @webatlas/shared`, `npm run build -w @webatlas/shared`, `npm run test:api`, `npx tsc -p apps/api/tsconfig.json --noEmit`, and the atlas-data suite for the file Task 6 touches (from Git Bash).

## Rulings Beyond the Spec

Facts found while writing this plan (2026-10-24), each with the choice made:

1. **Open code lists keep their stored values as codes.**
   - Today's lists hold Vietnamese words (`lake_type`: `Hồ chứa`, `Ao`; `risk_level`: `Cao`, `Trung bình`), not slugs.
   - A listed value's `code` is the stored value exactly. Its default `name` equals the code unless a better Vietnamese name exists.
   - The spec's "lowercase slug" applies only to codes staff add in Plan C, and is relaxed to trimmed, non-empty text of at most 100 characters.
2. **Text columns that hold numbers with units stay `text`, with no stored unit.**
   - These are `flood_zones.area` (`22.8 km2`), `flood_generation.area` and `flow_rate`, `saltwater_intrusion.salinity` (`4.2 g/l`), `stations.value` (`Mực nước: 2.3m`), and `dams.year_launched` and `year_operational` (`2013`, `7/2005`).
   - The physical type is locked, so no conversion applies. The definition names the unit in words.
   - Turning them into numbers is data work for P5/P9.
3. **Flood depth is a raster served as PNG frames, not a database table.** Its entry has no `table`, and the schema test skips it. The spec's "DEM, flood depth" stands.
4. **Stored-unit periods arrive with the stored-unit correction in Plan C.** Plan A records only each entry's lifetime (`validFrom`, `validTo`).
5. **Helpers take the dictionary explicitly,** e.g. `labelFor(dictionary, layer, name)`, so they stay pure. The spec wrote `labelFor(layer, name)`.
6. **Some columns are not attributes:** the bookkeeping columns `id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `dataset_version_id`, `deleted`, `is_current`, `province_codes`, `ward_codes`, every geometry or raster column, and the raster table's `rid` and `filename`. Geometry is described by the feature type.
7. **These are attributes:** `managing_unit` and the river topology columns `feature_level`, `parent_external_id`, `flows_into_external_id` and `match_confidence`. `feature_level` is a closed list (1, 2, 3), because application code branches on it.
8. **Dam `status` is the only other closed list,** because `dam-status.ts` branches on it (spec assumption 1).
9. **`annual_output` is stored in GWh per year.** The dam popup already shows `GWh/năm`, so the stored unit is `GW.h/a`.
10. **`kg/(m2.s)`** (precipitation flux in model output) is in the `rate` dimension with `assumesWaterDensity: true` (1 kg m⁻² s⁻¹ = 1 mm/s of water).
11. **The flood scenario's series, hourly, plan and scenario tables are not layers with popups,** so they get no entries. The covered scenario tables are `flood_station`, `flood_ward`, `flood_road`, `shelter` and `flood_history`.
12. **The Bộ group template** in `access.ts` does not gain `dictionary.manage`; an admin grants it explicitly.
13. **The sync takes a transaction-scoped advisory lock,** so two runs (e.g. `atlas:up` and a manual run) never interleave.
14. **The GeoPackage template is written with `node:sqlite`.**
    - It is built into Node 22.13 and adds no dependency.
    - Node prints one `ExperimentalWarning` per process the first time it loads. The template module imports it lazily, so only template requests trigger it.
15. **Raster layers have no template.** Requests for one get 404 with *Lớp ảnh không có tệp mẫu.*

## Review Focus

1. **vi-VN number input** where a dot is a thousands separator and a comma is the decimal mark.
   - `1.250,5` reads as 1250.5.
   - `1.5` and `1,2,3` are refused, never guessed.
   - → Task 2 test `parseDisplay refuses ambiguous separators`.
2. **Temperature and other offset units.**
   - K ↔ °C round-trips exactly at 2 decimals.
   - `formatValue` on null, NaN or a non-number shows `—`, never `NaN`.
   - → Task 1 test `offset units round-trip`; Task 2 test `formatValue shows a dash for missing values`.
3. **A text column holding a number with its unit** (`22.8 km2`). It is shown as stored, never parsed or converted, and an entry that gives a text attribute a stored unit fails validation. → Task 2 test `a text attribute with a stored unit is a validation problem`.
4. **A staff edit invalidated by a code change** (the edited display unit no longer permitted). The sync reverts it to the default and writes a history row with reason `sync_revert`. → Task 6 test `an edit the code no longer permits is reverted with history`.
5. **Two syncs at once.** The second waits for the first, and the result equals one run. → Task 6 test `two concurrent syncs end in the same state as one`.

---

### Task 1: The unit table and conversion

**Files:**
- Create: `packages/shared/src/dictionary/units.ts`, `packages/shared/src/dictionary/units.test.ts`

**Interfaces:**
- Produces, in `units.ts`:
  - `type Dimension = 'length' | 'area' | 'volume' | 'flow' | 'power' | 'energy' | 'rate' | 'temperature' | 'concentration' | 'time' | 'dimensionless'`
  - `interface UnitDef { code: string; dimension: Dimension; factor: number; offset?: number; symbol: string; assumesWaterDensity?: boolean; approximate?: boolean }`. Base value = value × factor + offset.
  - `const UNITS: Readonly<Record<string, UnitDef>>`, keyed by UCUM code.
  - `function unit(code: string): UnitDef`: throws `Error('Unknown unit <code>')`.
  - `function sameDimension(a: string, b: string): boolean`
  - `function convert(value: number, from: string, to: string): number`: throws `Error('Cannot convert <from> to <to>')` across dimensions.
  - `function unitsOfDimension(dimension: Dimension): UnitDef[]`
  - `function commonConversions(code: string): { to: string; factor: number }[]`: the other units of the same dimension with 1 `code` expressed in each; empty for offset units.

The table must contain at least these codes, with Vietnamese symbols:

| Dimension | UCUM code → symbol |
|---|---|
| length | `m` → m, `km` → km, `cm` → cm, `mm` → mm |
| area | `m2` → m², `km2` → km², `ha` → ha |
| volume | `m3` → m³, `10*6.m3` → triệu m³, `km3` → km³, `L` → lít |
| flow | `m3/s` → m³/s, `L/s` → l/s, `10*6.m3/d` → triệu m³/ngày, `km3/a` → km³/năm |
| power | `W` → W, `kW` → kW, `MW` → MW, `GW.h/a` → GWh/năm |
| energy | `kW.h` → kWh, `MW.h` → MWh, `GW.h` → GWh |
| rate | `mm/h` → mm/giờ, `mm/d` → mm/ngày, `mm/mo` → mm/tháng, `mm/s` → mm/s, `kg/(m2.s)` → kg/(m²·s) (`assumesWaterDensity`) |
| temperature | `K` → K, `Cel` → °C (offset 273.15) |
| concentration | `g/L` → g/l, `mg/L` → mg/l, `kg/m3` → kg/m³, `[ppth]` → ‰ (`approximate`, factor 1 to g/L) |
| time | `s` → giây, `h` → giờ, `d` → ngày, `a` → năm |
| dimensionless | `1` → (empty), `%` → % |

`GW.h/a` (energy per year, stored for `annual_output`) is in the `power` dimension with factor `1e9 / 8766` W, using a 365.25-day year, so it converts to MW. `mm/mo` uses a 30-day month. Both choices get a comment in the code.

- [ ] **Step 1: Write the failing tests** in `units.test.ts`:
  - `converts within a dimension`:
    - `convert(1, 'km2', 'ha') === 100`;
    - `convert(5_000_000, 'm3', '10*6.m3') === 5`;
    - `convert(1, 'm3/s', '10*6.m3/d')` is within 1e-9 of `0.0864`.
  - `refuses across dimensions`: `convert(1, 'MW', 'm3')` throws `Cannot convert MW to m3`.
  - `offset units round-trip`:
    - `convert(300, 'K', 'Cel')` is within 1e-9 of `26.85`;
    - `convert(convert(12.34, 'Cel', 'K'), 'K', 'Cel')` toFixed(2) is `'12.34'`.
  - `model precipitation flux converts to mm per day`: `convert(1 / 86400, 'kg/(m2.s)', 'mm/d')` is within 1e-9 of `1`.
  - `unknown unit throws`: `unit('furlong')` throws `Unknown unit furlong`.
  - `common conversions list the other units of the dimension`:
    - `commonConversions('km2')` contains `{ to: 'ha', factor: 100 }`;
    - `commonConversions('Cel')` is `[]`.
  - `every unit has a symbol and a positive factor`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- units`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `units.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): bảng đơn vị UCUM và quy đổi trong cùng thứ nguyên` (shared `dist` is built and committed in Task 2, together with the index export).

---

### Task 2: Dictionary types, helpers and validation

**Files:**
- Create in `packages/shared/src/dictionary/`: `types.ts`, `format.ts`, `validate.ts`, `merge.ts`, `index.ts`, and tests `format.test.ts`, `validate.test.ts`, `merge.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './dictionary/index.js';`)

**Interfaces:**
- Consumes: Task 1's `unit`, `convert`, `sameDimension`, `UNITS`.
- Produces, in `types.ts`:
  - `type ValueType = 'text' | 'number' | 'date' | 'code'`
  - `type AttributeSource = 'column' | 'extra' | 'band'`
  - `type GeometryMeaning = 'exact' | 'approximate' | 'representativePoint'`
  - `interface DictValue { code: string; name: string; definition?: string; order: number; retired?: boolean; colorHint?: string }`
  - `interface DictAttribute { name: string; source: AttributeSource; valueType: ValueType; label: string; definition: string; storedUnit?: string; displayUnits?: string[]; displayUnit?: string; precision?: number; cfStandardName?: string; codeList?: 'closed' | 'open'; values?: DictValue[]; nodata?: number; scale?: number; offset?: number; validFrom: string; validTo?: string }`
  - `interface DictFeatureType { key: string; kind: 'vector' | 'raster'; name: string; definition: string; table?: string; crs: number; geometryType?: OgcGeometryType; geometryMeaning: GeometryMeaning; validFrom: string; validTo?: string; attributes: DictAttribute[] }`
    - `table` is `schema.table`; for rasters it is the raster table.
    - `OgcGeometryType` comes from `../layer-geometry.js`.
  - `type Dictionary = Readonly<Record<string, DictFeatureType>>`
  - `const BOOKKEEPING_COLUMNS: readonly string[]`: the list in Ruling 6.
- Produces, in `format.ts`:
  - `labelFor(dictionary: Dictionary, layer: string, name: string): string`: the label, or `name` when there is no entry.
  - `attributeOf(dictionary: Dictionary, layer: string, name: string): DictAttribute | undefined`
  - `formatValue(attribute: DictAttribute, stored: unknown): string`
    - `—` for null, undefined, NaN or a non-finite number.
    - For `number` with units: convert storedUnit → displayUnit, `toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: precision ?? 2 })`, then a space and the display symbol (omitted for unit `1`).
    - `code` → `valueName`.
    - `text` and `date` → `String(stored)` unchanged.
  - `parseDisplay(attribute: DictAttribute, text: string): { ok: true; value: number } | { ok: false; message: string }`
    - Accepts `-?\d{1,3}(\.\d{3})*(,\d+)?` or `-?\d+(,\d+)?`, trimmed, with an optional trailing display symbol.
    - Converts displayUnit → storedUnit.
    - Otherwise returns `{ ok: false, message: 'Không đọc được số "<text>". Dùng dấu phẩy cho phần thập phân, ví dụ 1.250,5.' }`.
    - On a non-number attribute returns `{ ok: false, message: 'Trường "<label>" không nhận giá trị số.' }`.
  - `valueName(attribute: DictAttribute, code: string): string`: the value's name, or the code itself when unknown.
- Produces, in `validate.ts`:
  - `validateDictionary(dictionary: Dictionary): string[]`: problems in English, one per line, empty when valid. The rules:
    - feature type keys match their record key;
    - attribute names are unique within a feature type;
    - `storedUnit`, `displayUnits` and `displayUnit` are known units;
    - every display unit has the stored unit's dimension;
    - `displayUnit ∈ displayUnits`;
    - a stored unit without display units is a problem;
    - a `text` or `date` attribute with any unit is a problem;
    - `code` ⇔ `codeList` and non-empty `values`;
    - value codes are unique;
    - `precision` is in 0–6;
    - `validFrom` and `validTo` are `YYYY-MM-DD` with from ≤ to;
    - vector ⇔ `geometryType`;
    - raster attributes are all `band`, and vector attributes are never `band`;
    - `crs ∈ {4326, 3857}`.
- Produces, in `merge.ts`:
  - `mergeDictionary(defaults: Dictionary, served?: readonly DictFeatureType[]): Dictionary`: a served feature type replaces the default with the same key, and defaults fill the rest. With `served` undefined it returns `defaults`.
- `index.ts` re-exports the units, types and helpers. It does not export `DICTIONARY` yet; Task 3 adds it.

- [ ] **Step 1: Write the failing tests.**
  - In `format.test.ts`, with a fixture attribute `{ name: 'volume_mcm', valueType: 'number', storedUnit: 'm3', displayUnits: ['m3', '10*6.m3'], displayUnit: '10*6.m3', precision: 1, … }`:
    - `formatValue converts to the display unit and formats in vi-VN`: `formatValue(attr, 1_250_500_000)` is `'1.250,5 triệu m³'`;
    - `formatValue shows a dash for missing values` (null, undefined, NaN, `'abc'` on a number attribute);
    - `parseDisplay reads vi-VN numbers and converts back`: `'1.250,5'` → 1_250_500_000, and `'1.250,5 triệu m³'` → the same;
    - `parseDisplay refuses ambiguous separators`: `'1.5'` and `'1,2,3'` are refused, and the message contains `Dùng dấu phẩy`;
    - `labelFor falls back to the raw name`;
    - `valueName falls back to the code`;
    - `a text value is shown as stored` (`'22.8 km2'` unchanged).
  - In `validate.test.ts`:
    - `a valid fixture has no problems`;
    - `a text attribute with a stored unit is a validation problem`;
    - `a display unit of another dimension is a problem`;
    - `a code attribute without values is a problem`;
    - `displayUnit outside displayUnits is a problem`.
  - In `merge.test.ts`:
    - `served feature types replace defaults and defaults fill the rest`;
    - `no served list returns the defaults`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- dictionary`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules and `index.ts`, and add the export to `src/index.ts`.
- [ ] **Step 4: Run** the same command, then `npm run build -w @webatlas/shared`. Expected: PASS; build clean.
- [ ] **Step 5: Commit** the sources and `dist` (force-add the new `dist/dictionary/*.js` and `*.d.ts`): `feat(shared): kiểu, định dạng vi-VN, kiểm tra hợp lệ và gộp từ điển dữ liệu`

---

### Task 3: Entries for the 8 editable layers, and the schema check

**Files:**
- Create: `packages/shared/src/dictionary/entries/{dams,rivers,lakes,stations,flood_zones,drought_points,saltwater_intrusion,flood_generation,index}.ts`, `packages/shared/src/dictionary/entries/entries.test.ts`
- Create: `apps/api/src/modules/dictionary/schemaCheck.test.ts`
- Modify: `packages/shared/src/dictionary/index.ts` (export `DICTIONARY`)

**Interfaces:**
- Consumes: Task 2's types and `validateDictionary`.
- Produces:
  - `DICTIONARY: Dictionary`, keyed by layer key.
  - Each editable entry has `table: 'water.<key>'`, `crs: 4326`, the geometry type from `LAYER_GEOMETRY`, and `validFrom: '2026-10-24'`.

**Content rules:**
- **Wording sources:**
  - Vietnamese labels come from the existing popups first (`apps/web/src/components/DynamicPopup.tsx`; e.g. *Sản lượng điện*, `GWh/năm`), then from the thuyết minh terms.
  - Definitions are one sentence.
  - Dam status value names come from `dam-status.ts`.
- **Units:**
  - `wattage_mw`: `MW`, displayed `MW` or `kW`.
  - `annual_output`: `GW.h/a`.
  - `volume_mcm`: stored `10*6.m3`, displayed `10*6.m3`, `m3` or `km3`.
  - `area_km2`: `km2`, displayed `km2` or `ha`.
  - `shore_len_km`: `km`.
  - `length_m`: `m`, displayed `km` (precision 1) or `m`.
  - `stream_order`: number with no unit.
- **Code lists:**
  - closed: `dams.status`, `rivers.feature_level`;
  - every other code list is open, with values taken from the dev database's distinct values (Ruling 1).
- **Text columns from Ruling 2** are `text` with no unit; the definition names the unit in words.
- **`geometryMeaning`:**
  - dams, stations, drought points: `representativePoint`;
  - rivers, lakes: `exact`;
  - flood zones, saltwater intrusion, flood generation: `approximate`.
- **CF standard names, where one fits:** e.g. `saltwater_intrusion.salinity` has none (it is text), and `rivers.length_m` has none.

- [ ] **Step 1: Write the failing tests.**
  - `entries.test.ts`:
    - `the dictionary validates`: `validateDictionary(DICTIONARY)` is `[]`;
    - `the eight editable layers are present` (`EDITABLE_LAYER_KEYS.every(k => DICTIONARY[k])`);
    - `dam status is closed and names come from dam-status`;
    - `volume is stored in million m³ and shown in triệu m³` (`formatValue(attributeOf(DICTIONARY, 'lakes', 'volume_mcm')!, 1250.5)` is `'1.250,5 triệu m³'`).
  - `schemaCheck.test.ts` (API, against the dev database through `getPool()`, read-only), for every entry whose `table` is set:
    - `every non-bookkeeping column of each table has an attribute`;
    - `no column attribute names a missing column`;
    - `geometry type and SRID match the table` (from `geometry_columns`).
    - Raster tables and tables without entries are skipped in this task; Task 4 extends the coverage.
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- entries`, then `npm run test -w @webatlas/api -- schemaCheck`. Expected: FAIL.
- [ ] **Step 3: Write the eight entry files and `entries/index.ts`,** and export `DICTIONARY`.
- [ ] **Step 4: Run** both commands, then build shared. Expected: PASS.
- [ ] **Step 5: Commit** (with `dist`, force-adding new files) `feat(shared): từ điển dữ liệu cho tám lớp biên tập được, kiểm tra khớp cấu trúc bảng`

---

### Task 4: Entries for read-only layers and rasters

**Files:**
- Create: `packages/shared/src/dictionary/entries/{provinces,wards,contours,osm_water,flood_stations,flood_wards,flood_roads,shelters,flood_history,dem,flood_depth}.ts`
- Modify: `entries/index.ts`, `entries/entries.test.ts`, `apps/api/src/modules/dictionary/schemaCheck.test.ts`

**Interfaces:**
- Consumes: Task 3's `DICTIONARY` and test files.
- Produces: the keys `provinces` (`admin.provinces`), `wards` (`admin.wards`), `contours` (`basemap.contours`), `osm_water` (`basemap.water_region`), `flood_stations` (`scenario.flood_station`), `flood_wards` (`scenario.flood_ward`), `flood_roads` (`scenario.flood_road`), `shelters` (`scenario.shelter`), `flood_history` (`scenario.flood_history`), `dem` (raster, `basemap.dem_region`) and `flood_depth` (raster, no table).

**Content rules:**
- **Units:**
  - `area_km2`: `km2`, displayed `km2` or `ha`.
  - `elevation_m`: `m`; `interval_m`: `m`.
  - `length_m`: `m`, displayed `km` or `m`.
  - `max_depth`: `m`, displayed `m` or `cm`.
  - `distance_m`: `m`.
  - `level_m`-style and `bd1`–`bd3`, `record_m`: `m`.
  - `people_est`, `buildings_*`: number with unit `1`.
  - `cut_hour`, `first_hour`, `deadline_hour`: `h`.
- **Rasters:**
  - `dem`: one band `1` (*Độ cao*), `m`, the nodata value read from the raster, `cfStandardName: 'surface_altitude'`, `crs` as stored (check `ST_SRID`).
  - `flood_depth`: one band `1` (*Độ sâu ngập*), `m`, displayed `m` or `cm`, `crs: 3857`, no CF standard name (none fits inland flood depth).
- **Code lists:** `osm_water.fclass`, `shelters.kind` and `flood_roads.fclass` are open, with values from distinct database values; `contours.is_index` is `code` with values `true` / `false` (*Đường cái* / *Đường con*), closed.

- [ ] **Step 1: Extend the tests.**
  - `entries.test.ts`: `read-only layers and rasters are present`; `the dem band is in metres with surface_altitude`; `raster entries have only band attributes`.
  - `schemaCheck.test.ts`: `raster entries with a table point at a raster column` (`raster_columns`). The column checks now cover all keyed tables.
- [ ] **Step 2: Run** both commands from Task 3. Expected: FAIL.
- [ ] **Step 3: Write the entries.**
- [ ] **Step 4: Run** both commands, then build shared. Expected: PASS.
- [ ] **Step 5: Commit** (with `dist`) `feat(shared): từ điển dữ liệu cho các lớp chỉ đọc và lớp ảnh`

---

### Task 5: Database tables and the permission

**Files:**
- Create: `apps/api/src/db/migrations/1000000000032_data-dictionary.cjs`
- Modify: `packages/shared/src/access.ts` (`PERMISSIONS`, `PERMISSION_LABELS`), `packages/shared/src/access.test.ts`
- Test: `apps/api/src/modules/dictionary/tables.test.ts`

**Interfaces:**
- Produces:
  - **Permission:** `'dictionary.manage'` in `PERMISSIONS`, labelled `'quản lý từ điển dữ liệu'`.
  - **`app.dictionary_feature_types`:**
    - `key text PK`, `kind text CHECK IN ('vector','raster')`, `name text`, `definition text`, `table_name text NULL`, `crs int`, `geometry_type text NULL`;
    - `geometry_meaning text CHECK IN ('exact','approximate','representativePoint')`;
    - `valid_from date`, `valid_to date NULL`;
    - `origin jsonb NOT NULL DEFAULT '{}'`, `revision int NOT NULL DEFAULT 0`, `synced_at timestamptz`.
  - **`app.dictionary_attributes`:**
    - `feature_type text REFERENCES app.dictionary_feature_types ON DELETE RESTRICT`, `name text`, PK (`feature_type`, `name`);
    - `ord int`;
    - `source text CHECK IN ('column','extra','band')`, `value_type text CHECK IN ('text','number','date','code')`;
    - `label text`, `definition text`;
    - `stored_unit text NULL`, `display_units text[] NOT NULL DEFAULT '{}'`, `display_unit text NULL`;
    - `precision smallint NULL CHECK (precision BETWEEN 0 AND 6)`;
    - `cf_standard_name text NULL`, `code_list text NULL CHECK IN ('closed','open')`;
    - `nodata float8 NULL`, `scale float8 NULL`, `value_offset float8 NULL`;
    - `valid_from date`, `valid_to date NULL`, `origin jsonb NOT NULL DEFAULT '{}'`, `revision int NOT NULL DEFAULT 0`.
  - **`app.dictionary_values`:**
    - (`feature_type`, `attribute`) `REFERENCES app.dictionary_attributes ON DELETE RESTRICT`, `code text`, PK (`feature_type`, `attribute`, `code`);
    - `name text`, `definition text NULL`, `ord int`, `retired boolean NOT NULL DEFAULT false`, `color_hint text NULL`;
    - `origin jsonb NOT NULL DEFAULT '{}'`.
  - **`app.dictionary_history`:**
    - `id bigserial PK`, `feature_type text`, `attribute text NULL`, `code text NULL`;
    - `field text`, `old_value jsonb`, `new_value jsonb`;
    - `reason text CHECK IN ('edit','restore','sync_revert','sync_retire')`;
    - `changed_by uuid NULL REFERENCES app.users ON DELETE SET NULL`, `changed_at timestamptz NOT NULL DEFAULT now()`.
  - `origin` maps an edited field name to `{ "by": uuid, "at": iso }`; an absent key means the default.
  - **Grants:** `GRANT SELECT` on the three content tables to `webatlas_assistant`. History is not granted.
  - **Permission constraint:** drop and re-add the CHECK on `app.access_group_permissions.permission` with the seven permissions. `down` restores the six, after first deleting any `dictionary.manage` grant rows.

- [ ] **Step 1: Write the failing tests.**
  - `access.test.ts`: `dictionary.manage is a permission with its Vietnamese label`.
  - `tables.test.ts`:
    - `the dictionary tables exist with their checks`: an insert of a bad `kind` fails, inside a transaction that is rolled back;
    - `the assistant role can read the content tables but not history` (`has_table_privilege`);
    - `an access group can be granted dictionary.manage` (insert inside a rolled-back transaction).
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- access` and `npm run test -w @webatlas/api -- dictionary/tables`. Expected: FAIL.
- [ ] **Step 3: Write the migration and update `access.ts`.** Run `npm run migrate:up -w @webatlas/api`, then build shared.
- [ ] **Step 4: Run** both commands, plus `npm run test -w @webatlas/api -- accessGroups` (the group editor lists permissions from `PERMISSIONS`). Expected: PASS. Also check `npm run migrate:down -w @webatlas/api` then `migrate:up` round-trips.
- [ ] **Step 5: Commit** (with `dist`) `feat(api): bảng từ điển dữ liệu, lịch sử và quyền quản lý từ điển dữ liệu`

---

### Task 6: The sync

**Files:**
- Create: `apps/api/src/modules/dictionary/syncPlan.ts`, `syncPlan.test.ts`, `sync.ts`, `sync.test.ts`, `apps/api/src/scripts/dictionarySync.ts`
- Modify: `apps/api/package.json` (script `"dictionary:sync": "tsx src/scripts/dictionarySync.ts"`), `packages/atlas-data/src/up.ts` and `packages/atlas-data/src/cli/up.ts` (run the sync right after `migrate`), and the atlas-data test that covers `migrate` in `up.ts`

**Interfaces:**
- Consumes: Task 3/4's `DICTIONARY`; Task 5's tables.
- Produces, in `syncPlan.ts` (pure):
  - `interface StoredState { featureTypes: StoredFeatureType[]; attributes: StoredAttribute[]; values: StoredValue[] }`: rows as read, each with `origin: Record<string, { by: string; at: string }>`.
  - The locked fields of spec §2.2, as exported constants:
    - `LOCKED_FEATURE_TYPE_FIELDS = ['kind', 'table', 'crs', 'geometryType'] as const`;
    - for attributes, `source` always, `valueType` when `source !== 'extra'`, `storedUnit` (Plan C adds its guarded correction), and the codes of a `closed` list. Everything else is editable.
  - `planSync(defaults: Dictionary, stored: StoredState, today: string): SyncPlan`
  - `SyncPlan = { inserts: …; updates: …; retires: …; reverts: { featureType: string; attribute?: string; field: string; reason: string }[] }`
  - The rules are spec §2.1:
    - new → insert;
    - locked fields → overwrite;
    - editable fields with no `origin` entry → take the code value;
    - editable fields with an `origin` entry → keep, unless invalid under the new code (a display unit not permitted, or a precision out of range), in which case → revert;
    - gone from code → set `validTo = today` (once; already-retired rows are untouched).
- Produces, in `sync.ts`:
  - `runSync(pool: Pool, opts: { dryRun: boolean; today?: string }): Promise<{ added: number; updated: number; retired: number; reverted: number }>`
  - It reads state, plans, then applies in one transaction under `pg_advisory_xact_lock(hashtext('dictionary_sync'))`.
  - It writes `sync_revert` and `sync_retire` history rows, and sets `synced_at`.
  - `dryRun` rolls back.
- **The script** prints one line in the language and style of `src/scripts/workspaceCleanup.ts`, with the four counts, and `--dry-run` passes through.

- [ ] **Step 1: Write the failing tests.**
  - `syncPlan.test.ts` (pure fixtures):
    - `an empty store gets every entry inserted`;
    - `an untouched field follows a changed code default`;
    - `an edited label is kept`;
    - `a locked field is overwritten even if edited`;
    - `an edit the code no longer permits is reverted with history`;
    - `an entry removed from code is retired once`.
  - `sync.test.ts` (dev database; each test runs inside a transaction it rolls back, by calling the applier on a client):
    - `a second run changes nothing` (counts all 0);
    - `two concurrent syncs end in the same state as one` (two clients, `Promise.all`, then compare row snapshots);
    - `dry run writes nothing`.
  - The atlas-data test for `up.ts`: `atlas:up runs the dictionary sync after migrations`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- dictionary/sync`, and the atlas-data test file from Git Bash. Expected: FAIL.
- [ ] **Step 3: Implement** the planner, the applier, the script, the package script and the `up.ts` step (failure message: `dictionary sync failed (npm run dictionary:sync -w @webatlas/api):`).
- [ ] **Step 4: Run** the tests, then `npm run dictionary:sync -w @webatlas/api` twice on the dev database. Expected: tests PASS; the first run adds every entry; the second prints all zeros.
- [ ] **Step 5: Commit** `feat(api): đồng bộ từ điển dữ liệu từ mã vào cơ sở dữ liệu, giữ chỉnh sửa của cán bộ`

---

### Task 7: The read API

**Files:**
- Create: `apps/api/src/modules/dictionary/repository.ts`, `service.ts`, `controller.ts`, `routes.ts`, `dictionary.test.ts`
- Modify: `apps/api/src/server.ts` (register with prefix `/api`)

**Interfaces:**
- Consumes: Task 5's tables, filled by Task 6's sync.
- Produces:
  - `GET /api/dictionary` (public) → `{ version: string; featureTypes: DictFeatureType[] }`.
    - Entries are rebuilt from the database rows into Task 2's shapes, retired entries included with their `validTo`.
    - `version` is a hash of `max(synced_at)`, the latest history `changed_at` and the row counts. It is sent as a strong `ETag`.
    - `If-None-Match` equal to it → 304 with no body.
  - `GET /api/dictionary/:layer` (public) → one `DictFeatureType`; unknown → 404 `{ message: 'Không có lớp "<layer>" trong từ điển dữ liệu.' }`.
  - Both routes use the repo's existing rate-limit and error conventions (see `adminUnits` routes).

- [ ] **Step 1: Write the failing tests** in `dictionary.test.ts` (run the sync first in `beforeAll`):
  - `lists every feature type without authentication`: includes `dams`, and the `lakes.volume_mcm` attribute has `storedUnit: '10*6.m3'`;
  - `round-trips into the shared types`: `validateDictionary` over the served list keyed by `key` is `[]`;
  - `answers 304 to a matching If-None-Match`;
  - `one layer by key, 404 with the Vietnamese message for an unknown key`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- dictionary/dictionary`. Expected: FAIL.
- [ ] **Step 3: Implement** repository → service → controller → routes, and register them.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): API đọc từ điển dữ liệu công khai với ETag`

---

### Task 8: Upload templates, and the full checks

**Files:**
- Create: `apps/api/src/modules/dictionary/template.ts`, `template.test.ts`
- Modify: `apps/api/src/modules/dictionary/routes.ts`, `controller.ts`

**Interfaces:**
- Consumes: Task 7's service (one feature type from the database).
- Produces:
  - `csvTemplate(ft: DictFeatureType): string`
    - UTF-8 with a BOM.
    - One header row: every current `column`-source attribute name in `ord` order. For point layers it is followed by `kinh_do` and `vi_do`; for line and polygon layers, by `wkt`.
    - CRLF line endings.
  - `gpkgTemplate(ft: DictFeatureType): Promise<Buffer>`
    - Writes a GeoPackage 1.3 with `node:sqlite` (lazy `await import('node:sqlite')`) into a temp file under `os.tmpdir()`, reads it, and deletes that one file.
    - Content: `application_id` 0x47504B47; `user_version` 10300; the `gpkg_spatial_ref_sys` rows for -1, 0 and 4326; `gpkg_contents` and `gpkg_geometry_columns` rows; a feature table named `ft.key` with an integer `fid` primary key, a geometry column `geom` of the feature type's geometry type, and one column per current `column` attribute (`number` → REAL; `text`, `code` and `date` → TEXT); no rows.
  - **Routes** (public):
    - `GET /api/dictionary/:layer/template.csv` → `text/csv; charset=utf-8`;
    - `GET /api/dictionary/:layer/template.gpkg` → `application/geopackage+sqlite3`;
    - both with `Content-Disposition: attachment; filename="mau-<key>.<ext>"`;
    - a raster layer → 404 `{ message: 'Lớp ảnh không có tệp mẫu.' }`; an unknown layer → Task 7's 404.

- [ ] **Step 1: Write the failing tests** in `template.test.ts`:
  - `the CSV template has the dam columns and lon/lat`: after the BOM, the first line starts with the dams' attribute names and ends with `kinh_do,vi_do`;
  - `the GeoPackage template opens and has the right table`: write the buffer to a temp file, open it with `node:sqlite`, and check `PRAGMA application_id`, the `gpkg_contents` row for `lakes`, `table_info(lakes)` naming `volume_mcm` as REAL, and zero rows;
  - `a raster layer has no template`;
  - `the template file name is mau-<key>`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- dictionary/template`. Expected: FAIL.
- [ ] **Step 3: Implement** `template.ts` and the routes.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Run the full checks** from the Global Constraints: `npm run test -w @webatlas/shared`, `npm run build -w @webatlas/shared`, `npm run test:api`, `npx tsc -p apps/api/tsconfig.json --noEmit`, `npm run test:web` (shared types changed), `npm run build:web`, and the atlas-data file from Task 6. Expected: all pass; record the counts.
- [ ] **Step 6: Commit** `feat(api): tệp mẫu GeoPackage và CSV cho từng lớp theo từ điển dữ liệu`
