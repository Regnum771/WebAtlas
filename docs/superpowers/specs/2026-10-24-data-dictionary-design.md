# Data dictionary for official layers

**Status:** design agreed in brainstorming, 2026-10-24. Awaiting the user's review of this document.
**Builds on:** the personal-layer table (merged to local main `9b021cf`; its `columnLabel` hook waits for this work). The milestone spec `2026-10-19-map-upload-edit-rbac-design.md` sets the permission model and P5's column mapping. The redesign spec `2026-10-06-ui-redesign-design.md` plans the *Dữ liệu* section (`/du-lieu`, `/du-lieu/:id`).
**Order:** after the personal-layer table, before P4. Symbol sets follow as their own plan.

## Why

Official layers show raw or ISO column names (`wattage_mw`, `ratedPower`), with no units and no explanation. The facts about columns are spread over `layer-attributes.ts`, `dam-status.ts`, `feature-properties.ts`, `seed-columns.ts` and `legend.ts`, with no Vietnamese labels or units in one place. Data providers have no reference for the shape their uploads must take. Simulation and ML data arrive in SI units, while map readers and hydrologists expect *triệu m³*, *mm/ngày* and *°C*.

## Decisions

All made by the user on 2026-10-24.

| # | Decision |
|---|---|
| DD1 | The dictionary serves both readers and data providers (a lookup for readers, a schema and template for uploaders), and staff maintain it in `/quan-ly`. |
| DD2 | Each measured attribute has a **stored unit** (what the data actually holds, often SI or a model's unit) and a **display unit** (common in maps and hydrology). Every reader converts with the same rules. The dictionary also lists other common units with their ratios. |
| DD3 | Staff edit wording and display: labels, definitions, value names, the display unit (from the permitted list) and precision. |
| DD4 | Coverage: the 8 editable layers, the read-only vector layers that have popups, and raster layers described per band. Content is written for layers that exist today; each catalogue map gets its entry when its data arrives. |
| DD5 | Editing needs a new permission, `dictionary.manage` (*quản lý từ điển dữ liệu*). It counts only when the access group's jurisdiction includes the whole country (`VN`). |
| DD6 | Readers see a quick sheet from an ⓘ on each layer row, and a full page at `/du-lieu/:lớp` reached through *Xem đầy đủ*. Staff edit at `/quan-ly/tu-dien`. |
| DD7 | The complete dictionary lives in **both** code (`packages/shared`) and the database. The user accepted the duplication. The database copy is the one that runs; the code copy holds the defaults, is type-checked and is the fallback. |
| DD8 | Structure is partly editable, but only within fixed lists the system can check (§2.2). A field is locked only where the database enforces it or where an edit would silently change what stored numbers mean. |
| DD9 | Adopted practice: the ISO 19110 feature-catalogue shape, UCUM unit codes, optional CF standard names, the stored CRS as an EPSG code, effective dating of entries, and a statement of what each layer's geometry stands for. |

Out of scope, recorded so it is not lost:

- **A gazetteer** (alias and multilingual name resolution, e.g. one feature reached by several spellings) belongs to search and the assistant's `locate_place`. It would be a separate project.
- **OSM or INSPIRE code-list mappings** for listed values could become one optional field later. INSPIRE Hydrography fits Vietnamese water data better than OSM tags.
- **Spatial equivalence on import** (exact, bounding box or centroid match) belongs to P5's feature matching.
- **Readers switching units.** Staff choose each display unit, and everyone sees that one.

## 1. What an entry holds

The model follows ISO 19110: a **feature type** (one per layer) holds **attributes** (columns or raster bands). A code-typed attribute holds **listed values**.

### Feature type (one per layer)

- `key`: the layer key (`dams`, `rivers`, `dem`, …).
- `kind`: `vector` or `raster`.
- Vietnamese `name` and `definition`.
- `crs`: the stored CRS as an EPSG code (4326 for vector layers, 3857 for COG rasters), taken from the registry in `crs.ts`.
- `geometryType` (vector only): the OGC type from `layer-geometry.ts`.
- `geometryMeaning`: `exact`, `approximate` or `representativePoint` (e.g. a dam drawn as one point).
- `validFrom`, `validTo`.

### Attribute (one per column or band)

- `name`: the database column, the jsonb key, or the band number.
- `source`: `column` (a physical column), `extra` (a key in P5's *extra attributes* jsonb) or `band`.
- `valueType`: `text`, `number`, `date` or `code`.
- Vietnamese `label` and `definition`.
- `storedUnit`: a UCUM code (`MW`, `m3`, `mm/d`, `K`). Absent for unitless values.
- `displayUnits`: the permitted display units, each a UCUM code with a Vietnamese symbol (*triệu m³*).
- `displayUnit` (the one shown) and `precision` (decimal places).
- `cfStandardName`: optional, from the CF standard-name table (e.g. `precipitation_flux`).
- `codeList`: `closed` or `open` (§2.2). Code-typed attributes only.
- For bands: `nodata`, and `scale` / `offset` when the raster packs values.
- `validFrom`, `validTo`. A stored-unit correction applies from a date, so older data versions keep the old unit.

### Listed value (code-typed attributes)

- `code`: the stored slug.
- Vietnamese `name` and `definition`.
- `order`, `retired`.
- `colorHint`: optional, so the legend and filter chips agree. Real styling belongs to the symbol-sets plan.

### Units

- A built-in UCUM table in `packages/shared` covers the quantities in use: flow, volume, length, area, power, energy, depth and precipitation rate, temperature, salinity and concentration. Each unit has a dimension, a factor and an offset to its base unit.
- Conversions are always computed from that table. Nobody types a factor.
- Converting between different dimensions is refused in code.
- The "common conversions" column on the page is generated from the same table (e.g. 1 km² = 100 ha, 1 m³/s ≈ 0,0864 triệu m³/ngày).

### Where it lives

- **Code:** `packages/shared/src/dictionary/` holds the typed entries per layer, the unit table and the helpers (§3.1).
- **Database:** `app.dictionary_feature_types`, `app.dictionary_attributes` and `app.dictionary_values` hold the full entries. Each row records an `origin` per editable field: the default, or edited by whom and when. `app.dictionary_history` records every change as field, old value → new value, who, when and why (staff edit, sync revert, restore).

## 2. Sync, editing and the API

### 2.1 Sync

`npm run dictionary:sync -w @webatlas/api` runs after `migrate:up`, and `atlas:up` calls it.

- **New entry in code:** inserted with the code's defaults.
- **Locked fields:** always overwritten from code.
- **Editable fields:**
  - never edited by staff → follow the code, so an improved default flows through;
  - edited → kept.
- **Entry removed from code:** marked retired, with `validTo` set to today. Nothing is deleted.
- **A staff edit that a code change made invalid** falls back to the default, with a history row giving the reason. Examples: a display unit no longer permitted, or an open code list that became closed.
- Every run prints one summary line (added, updated, retired, edits reverted). `--dry-run` shows the changes without applying them.
- Running it twice in a row changes nothing.

### 2.2 What staff may edit

**Editable from a fixed list:**

| Field | Choices | Why it is safe |
|---|---|---|
| Wording: label, definition, value names | free text | Read only by people |
| Display unit and precision | One of the permitted display units; 0–6 decimals | The factor comes from the unit table |
| Permitted display units | Units of the same dimension as the stored unit, from the unit table | The factor comes from the unit table |
| CF standard name | The CF standard-name table | Descriptive only |
| What the geometry stands for | `exact`, `approximate`, `representativePoint` | Descriptive only |
| Codes of an **open** list | Add a code (lowercase slug) or retire one; deleting a code is never offered | The database accepts any text there |
| Retire or un-retire an entry | yes / no, with a date | Nothing is deleted |

**Editable with safeguards:**

| Field | Safeguard |
|---|---|
| Stored unit | Only to a unit of the same dimension. The change takes a *valid from* date. The form first shows five real values before and after, then asks for confirmation. It corrects a wrong claim about the data; it never converts the data. |
| Value type of an `extra` key | `text`, `number`, `date` or `code`. These keys have no database type, so the dictionary is the only place it lives. |

**Locked (overwritten from code at every sync):**

- which physical columns exist, and their names;
- the type of a physical column;
- the codes of a **closed** list;
- the layer's stored CRS and geometry type.

**Closed or open.** A code list is closed when the database enforces it (a CHECK constraint or an enum) **or** when application code branches on its codes. Finding, 2026-10-24: no `water.*` code column has a database constraint today. Dam status is still closed, because `dam-status.ts`, its styling and its popup branch on its slugs. Every other code list is open unless the plan finds code that depends on it.

### 2.3 Editing in `/quan-ly/tu-dien`

- The page needs `dictionary.manage` with `VN` in the group's jurisdiction. The API enforces this too.
- There is one form per attribute. Locked fields show greyed out with *theo cấu trúc dữ liệu*.
- *Khôi phục mặc định* works per field and for the whole entry: it removes the edit, and the code default applies again.
- Every save writes history. Dictionary edits need no approval step.
- Saves carry a revision. A stale save is refused with *Mục này vừa được người khác sửa.*, and the form reloads.

### 2.4 API

| Route | Access | Returns |
|---|---|---|
| `GET /dictionary` | public | The full current dictionary, with an ETag |
| `GET /dictionary/:layer` | public | One feature type with its attributes and values |
| `GET /dictionary/:layer/template.gpkg`, `.csv` | public | An empty template: the right column names and types, no rows |
| `PATCH /dictionary/:layer/:attribute` | `dictionary.manage` on VN | The updated entry; the body is validated against the fixed lists |
| `POST /dictionary/:layer/:attribute/restore` | `dictionary.manage` on VN | The entry with the named fields back at their defaults |
| `GET /dictionary/history?layer=&attribute=` | `dictionary.manage` on VN | History rows, newest first |

**Fallback:** if `GET /dictionary` fails, the web uses the code defaults bundled from `packages/shared`. Labels then show defaults, never raw names, and staff edits are missing until the call succeeds.

**Other readers of the database copy:** the Python worker (unit conversion for P5 imports) and the assistant's tools (labels and units in answers). GeoServer is unchanged: popups convert in the browser.

## 3. Conversion and who reads it

### 3.1 Shared helpers

- `labelFor(layer, name)`: the Vietnamese label, or the raw name when there is no entry (free and imported layers).
- `formatValue(attribute, stored)`: converts to the display unit and formats in vi-VN, e.g. `1.250,5 triệu m³`.
- `parseDisplay(attribute, text)`: reads a vi-VN number in the display unit and returns the stored value. It refuses with a Vietnamese message rather than guessing.
- `valueName(attribute, code)`: the Vietnamese name of a listed value. An unknown code shows as the code itself.
- `mergeDictionary(defaults, rows)`: lays database rows over code defaults; used by the web fallback and by tests.

### 3.2 Readers

| Reader | Change |
|---|---|
| Table (edit copies of official layers) | Headers use labels, with the definition on hover (through `columnLabel`). Cells show display units. Number conditions are typed in display units and converted before they reach the server. Code columns get a dropdown of value names. Free and imported layers keep raw names until P5. |
| Official feature form | Labels, a unit suffix on each input, values typed in display units and saved in stored units. ISO names stop showing. |
| Popups, the dam popup included | Labels, display units, value names. |
| Legend and print | Class boundaries and values go through `formatValue`. |
| Raster readouts (elevation at a point, elevation profile, zonal elevation, flood depth) | The band's display unit. |
| Assistant | Tools still compute in stored units; their results carry the label and the display-unit symbol. |
| API, exports, worker | Unchanged: stored units. |

## 4. Where it sits on the website

- **ⓘ on each layer row** in the side panel opens a quick sheet beside the panel. Each attribute shows its label, display unit and a one-line definition; code columns also show their number of values. The sheet ends with *Xem đầy đủ →*.
- **`/du-lieu`** lists layers grouped as vector and raster, with accent-insensitive search.
- **`/du-lieu/:lớp`**:
  - A header with name, kind, geometry and what it stands for, CRS and valid dates.
  - The attribute table: *Thuộc tính · Ý nghĩa · Kiểu · Đơn vị (lưu → hiển thị) · Quy đổi thông dụng · Giá trị · Tên chuẩn CF*. Code values expand.
  - *Tải mẫu tệp* downloads the GeoPackage or CSV template.
  - The page prints cleanly. It opens over the map, which stays mounted, as with `/quan-ly`.
  - Places for source, licence and data download are left for redesign sub-project 4 and are not built now.
- **The upload dialog** gets a link, *Cấu trúc các lớp chính thức →*, to `/du-lieu`.
- **`/quan-ly/tu-dien`** appears in the Quản lý menu only for holders of the permission. It holds the list, the edit form, the history and *Khôi phục mặc định*.
- Desktop first; the pages stay readable at 768 px.

## 5. Content, permission, errors and tests

### Content

- **Layers:**
  - the 8 editable layers;
  - the read-only vector layers that have popups (administrative units, basins, river reaches, contours, OSM water, flood-scenario outputs);
  - the rasters that exist today (DEM, flood depth).
- **Sources for the wording:** I draft the Vietnamese from the thuyết minh, the existing popups and `dam-status.ts`. The user or staff correct it in `/quan-ly/tu-dien`.
- **Stored units of today's columns:** several already hold hydrology units, e.g. `volume_mcm` (million m³), `area_km2`, `wattage_mw` and `shore_len_km`. For these the stored and display units start out the same.

### Permission

- `dictionary.manage` is added to `PERMISSIONS` in `packages/shared/src/access.ts`, labelled *quản lý từ điển dữ liệu*.
- A migration widens the CHECK constraint on access-group permissions.

### Errors

| Situation | Behaviour |
|---|---|
| `GET /dictionary` fails | Readers use the code defaults |
| An edit breaks a rule | Refused with a Vietnamese message naming the field |
| A stale save | Refused with *Mục này vừa được người khác sửa.* |
| A column of an official layer has no entry | The raw name shows, and the code-vs-schema test fails in CI |
| `parseDisplay` gets text it cannot read | Refused with a Vietnamese message; nothing is saved or queried |

### Tests

- **Units:** round trips; conversion between dimensions refused; K ↔ °C offset; vi-VN formatting and parsing.
- **Code vs schema** (against the dev database):
  - every physical column of each official table has an entry, and no entry names a missing column;
  - closed code lists match any database constraint;
  - stored CRS and geometry type match the tables.
- **Sync:** running twice changes nothing; staff edits are kept; invalid edits are reverted with a history row; entries removed from code are retired.
- **API:**
  - the permission granted with and without `VN` in the jurisdiction;
  - every fixed-list rule;
  - a stale revision;
  - template contents;
  - restore.
- **Web:** presenter tests for each reader in §3.2 and for the sheet, the pages and the staff form.
- **Browser check:** the ⓘ sheet, `/du-lieu/:lớp`, a staff edit, and a changed label appearing in both a popup and the table.

## 6. Splitting into plans

One spec, three plans, each reviewed and merged on its own (as P3a, P3b and P3c were). Execution is subagent-driven (user, 2026-10-24).

| Plan | Contents |
|---|---|
| **A: foundation** | The shared model, unit table, helpers and content; the database tables and history; sync; the read API and templates; the permission and its migration; the code-vs-schema test |
| **B: readers** | Table, filters, official form, popups, legend, print, raster readouts, assistant |
| **C: website** | The ⓘ sheet, `/du-lieu` and `/du-lieu/:lớp`, `/quan-ly/tu-dien` with editing, restore and history, the edit API, and the upload-dialog link |

Plan C's editing depends on Plan A's tables and permission. Plan B depends only on Plan A, so B and C could swap order.

## Assumptions awaiting the user's ruling

1. Dam status is the only closed code list today. Others become closed if the plan finds code that branches on them.
2. The template carries column names and types only. Allowed values are on the page, not encoded in the file.
3. The read API is public, like the map layers. Only editing and history need the permission.
4. Dictionary edits take effect at once, with no approval step.
5. Plan A ships no editing at all, neither UI nor API. Until Plan C lands, the database copy holds the code defaults only.
