# Filter & Search Fixes — Design

**Status:** approved, not yet implemented
**Branch:** `feat/attribute-filter` (follow-up commits; extends PR #11). Supersedes the dams-only search.
**Context:** four issues found in real use of the attribute filter (roadmap 2.3) + the legacy search bar.

## The four issues (diagnosed against code + live browser)

1. **Whiteout on filtering a river (e.g. "Sông Ba").** `useFilterPresenter.flyTo` treats the matched feature's geometry as a point: it passes `geom.getCoordinates()` straight to the view `center`. Rivers are **MultiLineString** (verified via WFS), so `getCoordinates()` returns a triple-nested array — an invalid `center` → the view jumps to garbage and the map blanks out. **Bug.**
2. **Search only finds dams.** `SearchBar` hardcodes a `webatlas:dams` WFS fetch, filters `name`/`name_en`, and its placeholder says "nhà máy thủy điện". It cannot find rivers, stations, or hazard features. **Scope gap.**
3. **Search bar obscured by the top bar.** `.search-bar-container` is `top: 24px; z-index: 10`; `.top-bar` is `top: 0; height: 52px; z-index: 1200`. The bar's top ~28px sits under the top bar. **Bug (CSS).**
4. **Cấp sông / Chiều dài filters read nonsensically.** `streamOrder` (Cap) is a Strahler ordinal 1–6 but is offered as a free numeric `≥/≤`; `length` (Chieu_dai) is raw meters (`1405.71…`) so "≥ 1405.710842 m" is absurd. Filters work but the UX is wrong. **Design.**

## Fixes

### F1 — fly-to on any geometry (shared helper)
Replace the point-only logic with the geometry's **extent center**, valid for points, lines, and polygons:

```ts
import { getCenter } from 'ol/extent';
// ...
const geom = f?.getGeometry();
if (!geom) return;
const center = getCenter(geom.getExtent());   // [x,y] in EPSG:3857
map.getView().animate({ center, zoom: 11, duration: 1000 });
```

Since **search (F2) needs the same fly-to**, extract a tiny shared helper
`features/attribute-filter/model/flyToGeometry.ts`:
`flyToGeometry(map, geom, zoom = 11)` — guards null map/geom, computes the extent center, animates. Both the presenter and the search bar call it, so there is one correct implementation. A line-geometry test stub (extent center ≠ any single vertex) guards the regression.

### F2 — cross-layer entity search
`SearchBar` stops fetching dams. It reads the **already-loaded features of every thematic layer** from the live map (the same `map.getLayers()` → source → `getFeatures()` path the presenter uses), matches each feature's `geographicalName` (the ISO name on loaded features) case-insensitively, and lists hits **tagged by layer** (Vietnamese layer label, reusing `LAYER_LABELS`). Clicking a hit calls `flyToGeometry`.

- Placeholder → `"Tìm kiếm..."`.
- No per-keystroke fetch — it filters in-memory data already loaded for display.
- A layer that isn't loaded simply contributes no hits (no error). Not-loaded layers are out of scope to auto-load for search — search reflects what's on the map.
- Cap results (e.g. 20) so a broad query doesn't render thousands of rows.
- The dams-only `useEffect` fetch and `DAMS_WFS_URL` are removed.

Search logic lives in a small module `features/attribute-filter/model/searchFeatures.ts`
(`searchAllLayers(map, query): SearchHit[]`) so it's unit-testable with a fake map, mirroring the presenter's testability.

### F3 — search bar clears the top bar
CSS only: `.search-bar-container` → `top: 64px` (below the 52px top bar) and `z-index: 1100` (above the map/panels at ≤1050, below the drawer at 1101 is fine since they don't overlap horizontally — the search is top-center, the drawer is top-left). Confirm in `/run` it no longer overlaps.

### F4 — sensible rivers fields
In `attribute-schema.ts`:
- `streamOrder` → `type: 'enum'`, `enumValues: ['1','2','3','4','5','6']` (ordinal, not free number). The enum `eq` match already stringifies both sides, so comparing the feature's numeric `streamOrder` against `'3'` works via the existing substring/stringified `eq`.

  **Note:** `applyFilter`'s `eq` is case-insensitive **substring** — `String(4).includes('4')`. For single-digit orders 1–6 there is no substring collision (no value contains another), so `eq` on `streamOrder` is exact in practice. Acceptable for this cut.
- `length` → stays `type: 'number'`, label `'Chiều dài (km)'`, and gains `scale: 1000`. A new optional `FilterField.scale?: number` means "divide the feature's raw value by `scale` before comparing", so the user enters km and `applyFilter` compares against `rawMeters/1000`.

`applyFilter` change: `Condition` gains an optional `scale?: number`; the numeric branch divides the feature value by `scale` (default 1) before comparing. The presenter sets `scale` on a condition from the field's `scale` when a numeric condition is added/updated. `FilterField` gains `scale?: number`.

## Architecture touchpoints

```
packages/shared/attribute-schema.ts     — FilterField.scale?; streamOrder enum; length km+scale
features/attribute-filter/model/
  flyToGeometry.ts        (new)         — shared extent-center fly-to
  searchFeatures.ts       (new)         — searchAllLayers(map, query) -> SearchHit[]
  applyFilter.ts          (modify)      — Condition.scale?; numeric branch divides by scale
  useFilterPresenter.ts   (modify)      — flyTo uses flyToGeometry; stamps scale on numeric conditions
components/SearchBar.tsx   (rewrite)    — cross-layer in-memory search via searchAllLayers + flyToGeometry
styles/main.css           (modify)      — .search-bar-container top/z-index
```

## Testing

- **`flyToGeometry`** — point geom → its coords; line/polygon geom → extent center (≠ a single vertex); null map/geom → no throw.
- **`searchFeatures`** — matches names across multiple fake layers; tags each hit with its layer; case-insensitive; empty query → capped/empty; a layer with no loaded features contributes nothing.
- **`applyFilter` scale** — `length ≥ 10` with `scale: 1000` matches a feature whose raw `length` is `11313` (11.3 km) but not `1405` (1.4 km).
- **schema** — `streamOrder` is `enum` with values `1..6`; `length` has `scale: 1000` and label in km.
- **presenter** — a numeric condition on a scaled field carries `scale` into `applyFilter`; fly-to on a line stub doesn't pass nested coords to `center`.
- **`/run`** — reproduce the exact bug: filter rivers by name "Ba" (or streamOrder), click a result → **map flies to the river, no whiteout**; search "Sông Ba" from the top bar → hits across layers, tagged; the search bar is fully visible below the top bar; rivers `Cấp sông` is a 1–6 dropdown and `Chiều dài ≥ 10 km` filters sensibly.
- **jsdom discipline** — no reachability/overlap assertions; F3's non-overlap is verified only in `/run`.

## YAGNI — not doing
- No fuzzy/ranked search — plain case-insensitive substring on name.
- No auto-loading off layers for search — search reflects loaded layers.
- No unit-parsing of the dirty string fields (area/salinity) — unchanged from 2.3; only `length` gets a scale because it's genuinely numeric.
- No search across non-`geographicalName` attributes.
