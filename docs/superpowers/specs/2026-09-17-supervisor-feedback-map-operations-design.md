# Supervisor Feedback — Map Operations, Assistant Updates, Print, CRS — Design

**Date:** 2026-09-17
**Status:** Approved design — not yet implemented
**Branch:** `feat/supervisor-feedback` (from `main` at `f3b6acd`). Registry Plan 2 is **paused**; its spec stays on
`feat/registry-plan-2`.
**Time box:** one day of implementation. Everything not built today is scoped here as a later phase.
**Read first:** [2026-09-14-spatial-analysis-tools-handover.md](2026-09-14-spatial-analysis-tools-handover.md) (tool
conventions, `candidateCtes`, prompt-prefix cost) and
[2026-09-07-ui-overhaul-and-map-assistant-design.md](2026-09-07-ui-overhaul-and-map-assistant-design.md) (the
`MapCommand` seam).

## Problem

Supervisors reviewed the atlas and asked for:

**Map operations surfaced directly from the assistant**

1. Search for points, lines and polygons, with results **highlighted** on the map.
2. Map operations (distance, area, buffer/outline) that **draw vector/raster results** on the map, plus the 5–10 most
   useful spatial analysis operations, added to the bottom toolbar.
3. Database update operations.
4. Updating Sông Hinh figures **through the assistant**, requiring a source document / provider.
5. Permissions: only admin may update; other users are read-only.
6. Report export and map printing.

**Additions to the system**

7. Import raster/vector data from other GIS systems (ArcGIS, MapInfo, QGIS, …).
8. WGS84 and other coordinate reference systems, toggled in the UI, with aliases.
9. Personalisation.
10. Decision support through AI modules on the map.

### State of the code at the time of writing

| # | Exists | Gap |
|---|---|---|
| 1 | `GET /api/search`; `highlightFeatures` command draws **points only** | Line/polygon highlight |
| 2 | Client-side length/area measure (`useMeasure.ts`); nothing persists or feeds further analysis | Buffer and analysis ops with drawn results |
| 3/4 | Assistant is read-only; `PUT /api/layers/:key/features/:id` accepts attribute-only bodies; `app.audit_log` stores before/after. Sông Hinh is dam `ID 324` in `thuydienvietnam.geojson` | NL → update path; source fields |
| 5 | `CAN_WRITE_FEATURES = ['admin', 'editor']` | Contradicts the requirement |
| 6 | Nothing | New |
| 7 | Pipeline-side ingest only (registry Plan 1) | New, large |
| 8 | Readout is EPSG:4326 only; no `proj4` | New |
| 9 | Nothing | New, under-specified |
| 10 | Assistant exists; 5 of 8 thematic layers are 2-row placeholders | Blocked on real data |

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Day-1 cut | Tier A: #5, #3/#4, #1. Tier B: #2, #6. Tier C (stretch): #8. #7, #9, #10 spec-only | Built in that order so stopping early still demos well |
| #5 is not a separate feature | It is the RBAC on the same update flow | User direction |
| `editor` role | Becomes read-only; enum value kept, no migration | Smallest reversible change; existing accounts keep logging in |
| #3/#4 shape | Chat → assistant proposes → **prefilled edit wizard** → admin confirms → existing `PUT` | User direction. No write path inside the model loop; the form's validation still applies |
| Source document / provider | Two **required** fields on the wizard, stored on the audit row. No file upload | User choice |
| Analysis architecture | One server-side PostGIS module, called by both the toolbar (HTTP) and the assistant (tools) | Mirrors the shared `MapCommand` seam; DEM ops must be server-side anyway; geodesic results |
| Result rendering | New `showGeometries` command; geometry never passes through the model | Zero token cost for geometry; one render path for search, toolbar and assistant |
| Operation set | 7: distance, area, buffer, select-within, nearest, elevation profile, zonal elevation | User choice |
| PDF | Browser print (`window.print()` + print CSS), no PDF library | One-day scope; print-to-PDF is universal |

---

## §1 Permissions (#5)

- **API:** `CAN_WRITE_FEATURES = ['admin']` in
  [capabilities.ts](../../../apps/api/src/hooks/capabilities.ts). `CAN_READ_FEATURES` unchanged. The `editor` enum value
  remains and now grants the same as `viewer`.
- **Web:**
  - `rolePersonas('editor')` → `['governance', 'research']` in
    [persona.ts](../../../apps/web/src/entities/persona/persona.ts); `PERSONAS.steward.requiredRole` → `'admin'`.
  - The edit drawer's `RequireRole` in
    [feature-editing/index.tsx](../../../apps/web/src/features/feature-editing/index.tsx) → `'admin'`.
  - User-management role option reads `editor (chỉ xem)`.
- **Assistant:** `ToolContext` gains `role: Role`. `propose_feature_update` is appended to the tool list **only when
  `role === 'admin'`**, after every unconditional tool (the `run_sql` precedent — admin and non-admin get two stable
  cached prefixes). A system-prompt rule: a non-admin asking to change data is told
  *"Bạn chỉ có quyền xem dữ liệu; chỉ quản trị viên mới cập nhật được."* and no tool is called.
- **The API remains the boundary.** A forged `proposeFeatureEdit` in a non-admin browser opens nothing useful: the
  wizard is admin-gated in the UI and `PUT` returns 403 regardless.

## §2 Assistant-driven update wizard (#3/#4)

### Flow

1. Admin: *"Cập nhật công suất thuỷ điện Sông Hinh thành 72 MW theo Quyết định 123/QĐ-UBND, Sở Công Thương Đắk Lắk
   cung cấp."*
2. Model resolves the feature with existing tools (`filter_by_attribute` / search), then calls
   `propose_feature_update({ layerKey, featureId, changes, sourceDocument?, sourceProvider? })`.
3. The tool:
   - validates `featureId` (`isFeatureId`) and loads the current active row via `resolveFeature` (§4);
   - checks every key in `changes` is a column of `LAYER_ATTRIBUTE_MAP[layerKey].attributes`; unknown columns → a
     Vietnamese error result naming the valid columns, nothing collected;
   - collects `proposeFeatureEdit` (validated by `isMapCommand`) and records provenance;
   - returns prose that states the proposal awaits confirmation, and asks for source document/provider if either was
     not supplied.
4. Browser executes `proposeFeatureEdit`: zoom to and highlight the feature (`showGeometries`), then open the
   **"Đề xuất cập nhật"** wizard.
5. Admin reviews, edits, fills source fields, confirms → `PUT` with `{ properties, source }`. Cancel writes nothing.
   Success refreshes the layer (existing `refreshLayer`) and posts *"Đã cập nhật."* into the assistant transcript.

### Contract

```ts
// packages/shared/src/map-commands.ts
| {
    kind: 'proposeFeatureEdit';
    layerKey: EditableLayerKey;
    featureId: string;
    name?: string;
    current: Record<string, string | null>;   // DB column → value
    proposed: Record<string, string | null>;  // only changed columns
    sourceDocument?: string;                  // ≤ 500 chars
    sourceProvider?: string;                  // ≤ 200 chars
  }
```

`isMapCommand`: layer key valid; every key of `proposed` and `current` is a column of that layer; `proposed` non-empty;
string length caps. Not a view command — the executor forwards it to a wizard callback rather than to OpenLayers.

### Wizard UI

- New `features/feature-editing/ui/ProposedEditWizard.view.tsx`, reusing `AttributeFieldView` for fields.
- All layer attributes shown, prefilled with `current` overlaid by `proposed`. Changed fields carry a marker and show
  the old value (`Trước: 70`).
- **Tài liệu nguồn** and **Người cung cấp**: required; Save disabled until both are non-blank.
- Presenter `useProposedEditPresenter` owns state; the view is passive (existing MVP pattern).
- Mounted only for `admin` (`RequireRole`).

### Storage

- Migration: `ALTER TABLE app.audit_log ADD source_document text, ADD source_provider text`.
- `FeatureBody` gains `source: { document: string(1..500), provider: string(1..200) }.optional()`.
- `featuresService.update/create` pass `source` to `audit.record`. Required in the wizard (client-enforced); optional
  on the API and in the manual edit drawer — making it mandatory for every geometry tweak is a later decision.

## §3 Highlight and `showGeometries` (#1)

### Contract

```ts
export type ResultRole = 'highlight' | 'input' | 'result';
export interface ResultGeometry {
  geometry: GeoJSONGeometry;          // EPSG:4326; Point/LineString/Polygon and Multi*
  role: ResultRole;
  label?: string;
  layerKey?: EditableLayerKey;
  featureId?: string;
}
| { kind: 'showGeometries'; items: ResultGeometry[]; fit?: boolean }
```

- Caps enforced by `isMapCommand`: `MAX_RESULT_ITEMS = 200`, `MAX_RESULT_VERTICES = 20_000` summed across items;
  coordinates finite and within lon/lat ranges.
- Server simplifies before emitting: `ST_SimplifyPreserveTopology(geom, tolerance)` with tolerance scaled to the
  geometry's extent (≈ extent / 2000), and never emits a command that fails its own validator.
- `highlightFeatures` stays unchanged (it is in the assistant's cached prefix and the UI emits it).

### Rendering

- [highlightLayer.ts](../../../apps/web/src/features/map/model/highlightLayer.ts) generalises into a results layer:
  `showResults(map, items, fit)` / `clearHighlights(map)` (clears both point highlights and results).
- Styles by role: `highlight` amber stroke/halo (lines 4px, polygons amber outline + 15% fill, points as today);
  `input` dashed dark stroke; `result` blue stroke + 25% blue fill. Labels as today.
- `fit: true` → `view.fit(extent, { padding, maxZoom: 14, duration: 400 })`.

### Callers

- **Search:** new public `GET /api/features/:layerKey/:id/geometry` → `{ geometry, name }` (active version, simplified).
  Selecting a hit fetches it and runs `showGeometries` with `fit: true`; falls back to the existing `zoomToFeature` if
  the fetch fails.
- **Assistant:** `highlight_features` gains optional `featureRefs: { layerKey, featureId }[]` (≤ 50); the tool
  resolves geometry server-side and collects `showGeometries`. An extension of an existing tool, not a new tool.

## §4 Analysis module (#2)

### Shared extraction (handover §5.3 #1)

`resolveFeature(pool, layerKey, featureId, prefix?)` in `tools/data/helpers.ts` → `{ name, geomGeoJson, lon, lat } |
null`, containing the candidate CTEs, the `NOT deleted` re-apply and `isFeatureId`. Used by `propose_feature_update`,
the geometry endpoint and the analysis ops. Existing tools are migrated only if trivially safe; not required today.

### Module

`apps/api/src/modules/analysis/` — `routes.ts`, `controller.ts`, `schemas.ts`, and one file per op under `ops/`, each a
pure function `(pool, input) → AnalysisResult`:

```ts
interface AnalysisResult {
  op: AnalysisOp;
  summary: Record<string, number | string>;   // displayed as label/value rows
  geometries: ResultGeometry[];               // ready for showGeometries
  rows?: { layerKey?: string; featureId?: string; name: string; [k: string]: unknown }[];  // ≤ 25
  profile?: { distanceM: number; elevationM: number | null }[];  // elevation_profile only
  attribution?: string;                       // FABDEM for DEM ops
}
```

Route: `POST /api/analysis/:op`, public like `/api/search`, own rate limit (60/min per IP). Inputs are Zod-validated:
input geometry ≤ 5,000 vertices and intersecting the region bbox; either a GeoJSON geometry **or** a
`{ layerKey, featureId }` reference where noted.

| Op | Input | PostGIS | Summary / output |
|---|---|---|---|
| `buffer` | geometry or feature ref; `radiusKm` (0 < r ≤ 100) | `ST_Buffer(geom::geography, m)::geometry` | area km²; result polygon + input drawn |
| `select_within` | polygon (drawn or a prior buffer); `layerKeys[]` | GiST `&&` + `ST_Intersects` candidate step, resolved and re-applied (§4.2 of the handover) | count per layer; ≤ 25 rows listed; all matches drawn up to the cap as `highlight` |
| `nearest` | point; `layerKey`; `k` ≤ 25 | KNN `<->` over-fetch then `ST_Distance(geography)` (logic shared with `nearestFeatures`) | name + distance per row; connector lines as `result` |
| `elevation_profile` | line; `samples` ≤ 200 (default 100) | `ST_LineInterpolatePoints` + `ST_Value(dem_region)` | length, min/max, total ascent/descent, mean slope %; `profile[]` |
| `zonal_elevation` | polygon | `ST_SummaryStats(ST_Clip(ST_Union(rast), geom))` over intersecting tiles | min/max/mean m, sampled area |

DEM ops reuse the tri-state from [elevation/repository.ts](../../../apps/api/src/modules/elevation/repository.ts):
`unavailable` (DEM never loaded) → 200 with `summary.status = 'Chưa nạp dữ liệu độ cao'`, not a 500.

### Toolbar and result card

- Bottom toolbar ([MapToolbar.tsx](../../../apps/web/src/features/map/ui/MapToolbar.tsx)) gains a **Phân tích** group:
  Đo khoảng cách, Đo diện tích (existing), Vùng đệm, Chọn trong vùng, Gần nhất, Trắc diện độ cao, Thống kê độ cao.
- Each button enters a draw/pick mode through a new `useAnalysisTool` hook in `features/map/model/` (OpenLayers stays
  quarantined there): line, polygon, point, or "pick a feature / use the current result". A small popover collects
  parameters (radius, layers, k).
- Measure results now persist as `input` geometries so they can feed buffer / select-within / profile ("use last
  shape").
- `AnalysisResultCard` (extends the existing `.measure-result` spot above the toolbar): summary rows, ≤ 25 listed rows
  (click → zoom), an inline SVG line chart for profiles (no chart library), **Xoá kết quả**, **Xuất CSV**.
- New slice `features/analysis/` (api + presenter + views); the toolbar hosts its buttons.

### Assistant tools

Appended to `FACTORIES`, never inserted: `buffer_feature`, `select_within`, `elevation_profile`, `zonal_elevation`.
Each is a thin wrapper: call the op, emit provenance (`rowCount`, and `datasetVersion` or DEM source), collect
`showGeometries`, return a Vietnamese summary. `nearest_features` already exists and additionally collects connector
geometries. The model has no drawn shape, so area inputs are given as `area: { layerKey, featureId, radiusKm? }`: a
polygon feature (lake, flood zone) used as-is, or any feature buffered by `radiusKm` first (e.g. "dams within 10 km of
river X"). A point/line feature without `radiusKm` is rejected with a Vietnamese error. `elevation_profile` takes a
line feature reference (a river).

## §5 Print and export (#6)

- **Entry:** "In / Xuất bản đồ" button in the top bar → `/print` route rendered over the still-mounted map (same
  sibling pattern as `/admin/users`).
- **Controls:** title; paper A4/A3 × portrait/landscape; toggles for legend, scale bar, north arrow, date, active CRS
  name, coordinates of the map centre. **Attributions are always printed** (OSM ODbL, Esri, FABDEM, Open Development
  Vietnam CC BY-SA) — this also closes the recorded unattributed-basemap gap for printed output.
- **Map image:** on `rendercomplete`, composite every layer canvas (respecting opacity and transform) into one canvas
  sized to the paper aspect → PNG.
- **Outputs:** **Tải PNG** (map image only); **In / PDF** via `window.print()` with `@media print` CSS laying out
  title, image, legend (`DynamicLegend` descriptors), scale, north arrow, date, attributions.
- **Report:** if an analysis result is active, the print page appends its summary and row table; the result card's
  **Xuất CSV** downloads rows (UTF-8 with BOM so Excel renders Vietnamese).
- **Risk — tainted canvas:** tiles without CORS headers block `toBlob`. Sources get `crossOrigin: 'anonymous'`. Verify
  GeoServer (WMTS/WMS), Esri and OSM tiles during implementation. If a source cannot be exported, PNG download shows
  *"Không xuất được ảnh do máy chủ bản đồ nền chặn"* and print still works (the browser prints the live DOM).

## §6 Coordinate reference systems (#8) — stretch

- `packages/shared/src/crs.ts`: `CRS_OPTIONS: { id, alias, proj4, kind: 'geographic' | 'projected' }[]`, registered
  with `proj4` in the web app (`ol/proj/proj4` `register`).
  - `WGS84` decimal degrees and DMS (EPSG:4326)
  - `WGS 84 / UTM 48N` (EPSG:32648), `49N` (EPSG:32649)
  - `VN-2000` geographic (EPSG:4756)
  - `VN-2000 / UTM 48N` (EPSG:3405), `49N` (EPSG:3406)
  - `VN-2000 / TM-3` per province, `k = 0.9999`, false easting 500 000 m, alias
    *"VN-2000 / <tỉnh> (KTT <kinh tuyến trục>)"*. Provinces merged on 01/7/2025 get one entry per former province.
- **Accuracy gate:** central meridians and the VN-2000 `towgs84` 7-parameter shift are taken from Thông tư
  973/2001/TT-TCĐC and verified during implementation; a test round-trips a published control point within 1 m. An
  entry that cannot be verified is not shipped.
- **Toggle:** dropdown on the bottom-right coordinate readout
  ([mapReadouts.ts](../../../apps/web/src/features/map/model/mapReadouts.ts)); selection in `localStorage` (wrapped in
  try/catch, default WGS84).
- **Effects:** cursor readout, coordinates shown in analysis results, CRS line on the print page. Map view stays
  EPSG:3857; stored data stays EPSG:4326.

## §7 Later phases (not built in this cycle)

| Phase | Item | Scope | Blocked on |
|---|---|---|---|
| P2 | #9 Personalisation | `app.user_preferences`: saved views (bbox, layers, basemap, CRS), default layer set, favourite features; restore on login | Nothing — smallest follow-up |
| P3 | #7 Import from GIS systems | Admin upload (Shapefile .zip, GeoPackage, GeoJSON, KML, MapInfo TAB/MIF, GeoTIFF) → GDAL/ogr2ogr in the raster-tools image → staging schema → field-mapping wizard → new `dataset_version` for an existing layer, or a new registry dataset. Reprojection from source CRS (reuses §6 definitions) | Registry Plan 2 (sub-project B) for vector; sub-project C (COG raster path) for raster |
| P4 | #10 AI decision support | Modules on the map: flood-exposure report per province (features inside flood zones), reservoir / drought risk summary, site-suitability scoring from weighted criteria | **Real hazard data** — 5 of 8 layers are placeholders; a module over them is correct and useless |
| — | More analysis ops | River clip/intersection length, convex hull, point density heatmap (raster), upstream/downstream tracing, watersheds | Tracing and watersheds blocked on topology / flow rasters (handover §6.6) |
| — | Report templates | Server-rendered PDF reports with fixed templates | Print page (§5) proving the layout first |
| — | Mandatory source on all edits | Require §2 source fields on every `PUT`/`POST` | A decision from supervisors |

## §8 Error handling

- Assistant tools: thrown errors become Vietnamese results via the existing `guardToolErrors`; empty results start
  with `Không có dữ liệu:`; every path emits provenance.
- Analysis route: Zod failures → 400 with the field; DEM unavailable → 200 with status; statement timeout 5 s → 504
  `ANALYSIS_TIMEOUT` with *"Phép phân tích quá lâu, hãy thu nhỏ vùng."*
- Wizard: `PUT` 403 → *"Bạn không có quyền cập nhật."*; 404 → *"Đối tượng không còn tồn tại."*; other → retry kept in
  the form, values preserved.
- Results over the render cap: the op still reports full counts; drawn items are truncated and the card says
  *"Hiển thị 200/…"*.

## §9 Testing and verification

- **Shared:** `isMapCommand` cases for `showGeometries` (caps, bad coordinates, bad roles) and `proposeFeatureEdit`
  (unknown column, empty proposal, length caps); CRS round-trip against a control point.
- **API (live DB):** `PUT` as editor → 403, as admin → 200 with `source_document`/`source_provider` stored; geometry
  endpoint; each analysis op on known fixtures (buffer area within tolerance, select-within counts, profile against
  `elevation_at_point` values); `buildTools` offers `propose_feature_update` only for admin; the proposal tool rejects
  unknown columns and collects nothing.
- **Web:** presenter tests for the wizard (Save gating on source fields, changed-field markers), analysis presenter,
  print options; `npm run build:web` for type-check (vitest skips it).
- **Live assistant (costs tokens, run once before sign-off):** routing cases for update proposal, buffer, select-within,
  elevation profile; non-admin update request refused.
- **Browser `/run`:** Sông Hinh wizard end-to-end; river highlighted along its length from search; buffer → select
  dams within; elevation profile chart; PNG download and print preview. jsdom cannot prove reachability — these are
  proven only in a browser.

## Implementation order

Tier A: §1 permissions → §3 `showGeometries` + geometry endpoint + search highlight → §2 wizard (depends on §3 for the
highlight). Tier B: §4 module + endpoint → toolbar + card → assistant tools → §5 print/export. Tier C: §6 CRS. Each tier
ends green (`test:api`, `test:web`, `build:web`) so the branch is demoable at every tier boundary.
