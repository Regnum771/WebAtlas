# Attribute Filter (Roadmap 2.3, first cut) — Design

**Status:** approved, not yet implemented
**Roadmap:** delivers the "filter" half of 2.3 (Query, filter & search). Search-upgrade and saved views (2.4) are explicitly out (§9).
**Prereq:** 2.2 adaptive shell (shipped, PR #10) — `docs/superpowers/specs/2026-07-17-shell-layout-restructure-design.md`.

## 1. What this builds

A client-side **attribute filter** over all 7 thematic layers, available to every role (anonymous → admin). It lives at the top of the map beside the existing search bar: a funnel button opens a filter panel. The user picks a layer, adds one or more AND-ed conditions typed by attribute, and gets a **result list** in the panel — clicking a result flies the map to that feature.

**The map itself is not restyled.** A filter produces a list of matches, not a change to how features are drawn. Clearing the filter clears the list. This keeps the first cut free of per-layer OpenLayers style work.

## 2. Scope decisions (locked during brainstorming)

- **Filter only** — not the search-bar rewrite, not saved views. (§9)
- **Client-side** on already-loaded OL vector features — no GeoServer `CQL_FILTER`, no new API endpoint. Layers are small (hundreds of features); filtering is instant and needs no round-trip.
- **Everyone** — no auth gate. Filtering is a display/analysis tool with no write dimension on public WFS layers.
- **Home: top bar, integrated with search** — a funnel button beside the search input opens the panel. Every role already sees the top bar, so no per-role drawer is needed (2.2 gave viewers/public no drawer).
- **Conditions: multiple, AND-ed, typed by attribute** — enum/text → value dropdown; number → operator (`≥ / ≤ / =`) + value; date → range.
- **Result: list + fly-to** — reuses the existing `SearchBar` result-item styling and view-animation.

## 3. The data path (verified against code)

Layers load via WFS `GetFeature` through `features/map/model/wfsSource.ts`. Crucially, that source **normalizes properties to ISO/INSPIRE names** on `featuresloadend` (via `normalizeFeatureProperties`), and for `dams` additionally stamps a canonical `statusSlug` and a display label on `operationalStatus`. So an in-memory feature's properties are the **ISO names** (`geographicalName`, `operationalStatus`, `ratedPower`, …), not the DB columns.

**The filter operates on ISO names.** The presenter reads features from the live map:

```
useMapContext().map            // ol/Map (exposed by MapProvider)
  → map.getLayers()            // find the layer whose get('id') === LAYER_ATTRIBUTE_MAP[key].layerStateId
  → layer.getSource().getFeatures()
  → feature.getProperties()    // ISO-named attributes to test
  → feature.getGeometry()      // for fly-to (may be absent; see §6)
```

**Loaded-vs-not:** a layer's features exist in memory only if that layer has been added/loaded. If the chosen layer has no features loaded, the panel says so and offers to enable it (via the existing `toggleLayerVisibility`), rather than silently showing 0 results. The exact layer-lookup helper (`map.getLayers()` scan by `id`) is confirmed against `MapModel.ts` during planning.

## 4. Architecture — `features/attribute-filter/`

New FSD slice, following the established presenter/props-only-view pattern (the discipline used throughout `features/*`: presenter returns a view-model + handlers, `*.view.tsx` are props-only):

```
features/attribute-filter/
  model/
    applyFilter.ts            — PURE: (features, conditions) -> matches. No OL, no DOM.
    useFilterPresenter.ts     — layer pick, conditions[], derived results; reads live features.
  ui/
    FilterButton.view.tsx     — funnel icon + active-condition-count badge (sits in the search row)
    FilterPanel.view.tsx      — layer picker + condition rows + result list + "Xóa lọc"
    ConditionRow.view.tsx     — one condition; input shape switches on field type
  index.tsx                   — container: wires presenter to views, hosts the panel

packages/shared/src/
  attribute-schema.ts         — NEW: per-attribute type descriptors keyed by ISO name
  attribute-schema.test.ts
```

### 4.1 The attribute schema (shared)

`LAYER_ATTRIBUTE_MAP` today maps DB column → ISO name but carries **no type info**. The filter needs to know, per attribute: is it an enum (which values?), a number, a date, or free text — so `ConditionRow` renders the right input and `applyFilter` compares correctly.

`packages/shared/src/attribute-schema.ts` adds a descriptor per **filterable** ISO attribute:

```ts
export type FilterFieldType = 'enum' | 'number' | 'date' | 'text';

export interface FilterField {
  iso: string;          // ISO/INSPIRE name, matches the in-memory feature property
  label: string;        // Vietnamese UI label
  type: FilterFieldType;
  enumValues?: string[]; // for 'enum' — the allowed values (canonical); optional
}

// Per EditableLayerKey, the attributes a user may filter on.
export const LAYER_FILTER_FIELDS: Record<EditableLayerKey, FilterField[]> = { … };
```

Rules:
- Keyed by **ISO name** (what's on the feature), not DB column.
- Only *useful* filter fields are listed — `localId` (external_id) and free-text-only ids are omitted; names are `text`.
- For `dams.operationalStatus`, the enum values are the **canonical status slugs** (filter on `statusSlug`, which the source already stamps), so a filter is robust against the display-label rewrite. This is the one field that filters on `statusSlug` rather than its ISO name; the descriptor records that mapping explicitly (`iso: 'statusSlug'`).
- **Types reflect the real (dirty) data, not the ideal.** Verified against seeds: hazard `riskLevel` is a Vietnamese enum (`"Cao"`/`"Trung bình"`), not `low/medium/high`. Several nominally-numeric fields are stored as **labeled strings** — `area: "120 km2"`, `salinity: "4.2 g/l"`, station `value: "Mực nước: 2.3m"` — so they are typed `text` (a numeric compare would fail). Only genuinely-numeric fields (dams `ratedPower`, rivers `streamOrder`/`length`) are `number`. Unit-stripping/parsing of the dirty fields is deferred (§9).
- Additive only — `LAYER_ATTRIBUTE_MAP`'s existing shape is untouched. `@webatlas/shared` rebuilds.

### 4.2 `applyFilter` (pure, the testable core)

```ts
export type Operator = 'eq' | 'gte' | 'lte' | 'between';
export interface Condition { field: string; op: Operator; value: unknown; value2?: unknown; }
// AND semantics: a feature matches iff it satisfies EVERY condition.
export function applyFilter(features: FeatureLike[], conditions: Condition[]): FeatureLike[];
```

`FeatureLike` is a minimal shape (`{ getProperties(): Record<string,unknown>; getGeometry(): unknown }`) so tests pass plain stubs — no OpenLayers in the test. Empty `conditions` → returns `[]` (no conditions means "no filter result", NOT "all features"; the list is empty until the user builds a filter). Null/absent property → that condition fails for that feature (never throws).

### 4.3 `useFilterPresenter`

Returns a view-model:

```ts
{
  layerKey: EditableLayerKey | null;
  fields: FilterField[];                 // for the active layer
  conditions: Condition[];
  results: FilterResult[];               // { id, label, subLabel, hasGeometry }
  count: number;
  layerLoaded: boolean;                  // false -> panel prompts to enable the layer
  isOpen: boolean;
  activeCount: number;                   // conditions.length, for the button badge
  setLayer; addCondition; updateCondition; removeCondition; clear;
  open; close; flyTo(id);                // flyTo reuses the SearchBar animate pattern
}
```

Reads live features via `useMapContext().map`. No fetch, no `apiRequest`.

## 5. Data flow

```
open funnel → pick layer → fields = LAYER_FILTER_FIELDS[layerKey]
  → add condition(s) (typed input via ConditionRow)
  → applyFilter(liveFeatures[layerKey], conditions) → results
  → panel lists results (name + a key attr) + count "N kết quả"
  → click result → flyTo(geometry)   [map.getView().animate, as SearchBar does]
  → "Xóa lọc" → conditions = [] → results = []
```

## 6. Errors & edge cases

- **No conditions:** empty result list (not all features).
- **Layer not loaded:** `layerLoaded=false` → panel shows "Bật lớp để lọc" with an enable action (`toggleLayerVisibility`), no crash.
- **Zero matches:** explicit "0 kết quả".
- **Feature without geometry:** appears in the list but is not fly-to-able (its row is non-navigable) — same rule the current `SearchBar` uses (it drops geometry-less features from navigation).
- **Null/unknown property values:** the condition simply doesn't match; never throws.
- **Number/date parse:** a non-numeric value entered for a number field is treated as "no constraint" for that row until valid (the row shows it needs a number), rather than filtering everything out.

## 7. Testing

- **`applyFilter`** (pure) — the bulk of coverage: each operator (`eq/gte/lte/between`), AND composition across 2–3 conditions, null/missing property, empty conditions → `[]`, geometry-less feature still matchable. Plain-object stubs.
- **`attribute-schema`** — every `EditableLayerKey` resolves to ≥1 `FilterField`; every `enum` field lists values; the `dams` status field targets `statusSlug`.
- **`useFilterPresenter`** — `renderHook`: pick layer → fields populate; add/update/remove condition → results re-derive; clear → empty; `layerLoaded` false path. `useMapContext` mocked with a fake map exposing stub features.
- **Views** — props-only render + interaction (funnel toggles panel; condition input shape by type; result click calls `flyTo`; badge shows `activeCount`).
- **`/run`** — against the live stack: open funnel, filter dams by status + wattage, see the count and list, click a result → map flies to it, clear. Confirm across a second layer (e.g. flood_zones by risk_level).
- **jsdom discipline carries over** (established during 2.2): jsdom has no layout engine, so no unit test asserts overlap/reachability/z-index. The panel's placement over the map is verified only in `/run`.

## 8. UI shape

Top-center search row gains a funnel button with an active-count badge. Clicking drops the `FilterPanel` below the bar (a `glass-panel`, absolutely positioned under the search input, same layering discipline as existing panels). Layer picker (dropdown of the 7 layers by their Vietnamese names) → condition rows (each: field dropdown, operator/value by type, remove ✕) → "+ thêm điều kiện" → result list + "N kết quả" + "Xóa lọc". All Vietnamese, matching existing copy.

## 9. YAGNI — explicitly NOT building

- **No search-bar rewrite** — the existing dams name-search stays as-is; the funnel is additive.
- **No saved views / named filters** — that's 2.4.
- **No map restyling** — no highlight/dim/hide of features; result is a list only.
- **No OR / nested logic** — AND-only.
- **No server-side filtering** — no `CQL_FILTER`, no `/api/…filter` endpoint.
- **No cross-layer filter** — one layer at a time.
- **No new auth surface** — client-side on public WFS; no gating.
- **No unit-stripping / numeric coercion of dirty fields** — `"120 km2"` etc. filter as text this cut. A future data-cleanup (or a parse layer) can promote them to numeric later.
