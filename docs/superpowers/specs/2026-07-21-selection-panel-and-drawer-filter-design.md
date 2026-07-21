# Selection, Detail Panel & Drawer Filter — Design

**Status:** approved, not yet implemented
**Branch:** new branch off `main` after PR #11 lands. Does not extend `feat/attribute-filter`.
**Context:** the attribute filter (roadmap 2.3) and the cross-layer search work, but they are two disjoint tools competing for the same screen space below the top bar, and neither connects to the map's existing selection. This design unifies them onto one query engine, moves the filter into the left drawer, and makes selection a first-class app concept with a detail panel.

## Problem

1. **Filter and search are the same operation built twice.** Search is a filter with one hardcoded condition (`geographicalName contains X`) across all layers; filter is a search with N conditions scoped to one layer. Two result lists, two fly-to call sites, two dropdowns below the search bar that overlap.
2. **Results only fly, they don't select.** Clicking a result animates the view but leaves no highlight and no way to inspect the feature. The user arrives somewhere with no confirmation of *what* they arrived at.
3. **Selection is welded to editing.** `SelectController` is instantiated only in the editing path, emits an edit-shaped payload (`EditSelection` with GeoJSON geometry + denormalized props), and has no programmatic entry point. Viewers cannot select anything.
4. **There is no display panel.** `apps/web/src/widgets/` contains only `top-bar`. The right-hand panel in the shell design was never built.
5. **The map view is constrained to the wrong box.** The view extent is a south-central coastal strip; most of Vietnam cannot be panned to. Min zoom is defined twice, inconsistently.

## Decisions

- **Filter moves into the left drawer**, available to every role. The drawer stops being steward-only.
- **The detail panel attaches to the drawer's right edge**, forming a two-panel block on the left. Both overlay the map.
- **Selection becomes role-agnostic and mode-free.** Any user selects anything, any time, by map click or from a result list.
- **Editing is entered explicitly** via a pen on the detail panel, never implicitly by selecting.
- **Search stays in the top bar.** Typing a name is transient and belongs there; filtering is stateful and belongs in a panel.

---

## §1 — Selection as a first-class entity

New slice `entities/selection`.

```ts
interface Selection {
  layerKey: EditableLayerKey;
  featureId: string;            // bare id, typename prefix stripped
  feature: Feature;             // the live OL feature
  isoProps: Record<string, unknown>;
}
```

One map-level OL `Select` interaction owns the highlight and is the single source of truth for "what is selected". Two entry points:

- `selectByClick` — the existing user gesture, hit-testing the 7 thematic layers.
- `selectById(layerKey, featureId)` — programmatic, called from result lists.

**Consolidating the two existing Select interactions.** There are currently two, which do not know about each other:

- `MapModel.ts:126` — a rivers-only `Select` with `makeRiverSelectStyle()`, always active, independent of everything else.
- `SelectController` — the editing one, installed only inside edit mode.

Both are replaced by the single selection interaction. The rivers highlight style is preserved as the per-geometry-type styling of the unified highlight (rivers keep their look; other layers get an equivalent treatment), so this is not a visual regression for rivers.

**Editing becomes a subscriber.** `useEditExistingPresenter` stops calling `enterEditMode(onSelected)` to install its own interaction and instead reads the current selection. The edit-shaped payload (GeoJSON geometry via `olGeometryTo4326GeoJSON`, denormalized props via `denormalizeFeatureProperties`) is derived *from* a `Selection` at the point the pen is pressed, not baked into the selection itself.

**`startModify` no longer fires on select.** Today `onSelected` immediately calls `startModify`, making geometry draggable the moment a feature is clicked. Under this design geometry is only modifiable behind the pen (§3), so browsing can never nudge a geometry.

This section is a **pure refactor with no user-visible behaviour change**. The existing editing tests staying green is the proof.

---

## §2 — The two-panel left block

**Drawer becomes universal.** `useShellPresenter.hasDrawer` is currently `available.includes('steward')`, so viewers get no drawer at all. It becomes unconditionally `true`. Role gating moves inside: the **Filter section** renders for everyone, the **Edit section** only for stewards. Backend authorization is unchanged — this is UX routing only, consistent with the existing persona rule.

**The detail panel attaches to the drawer's right edge**, sharing a border, forming one block. A round button straddles the seam:

- expanded → button shows `<<`, collapses the detail panel
- collapsed → button shows `>>`, expands it

**Collapsed is not deselected.** Folding the panel away keeps the selection and its map highlight intact; it only reclaims map area. Deselecting is a separate action.

**Panel visibility is driven by selection**, with collapse as an independent override:

| selection | collapsed | result |
|---|---|---|
| none | — | panel absent, **no button** |
| present | false | panel visible, button `<<` |
| present | true | panel hidden, button `>>` visible at the drawer's right edge |

The button exists only when there is a selection — it toggles an existing panel and never appears on its own.

Selecting a feature while collapsed expands the panel — the collapse flag resets on a *new* selection, so a result click always shows what you clicked.

**Both panels overlay the map.** The map viewport is not inset and OL needs no `updateSize()` on open/close. The cost is that a naive fly-to can land a feature underneath the block; §4 fixes that with fit padding.

---

## §3 — Panel contents and the pen

**Read-only by default, for every role including stewards.** The panel renders:

- title — `geographicalName`, falling back to `localId` then the feature id
- a layer tag — the Vietnamese label from `LAYER_LABELS`
- attributes — rendered through `LAYER_ATTRIBUTE_MAP[layerKey].attributes`, reusing the ISO→column mapping the edit form already uses, so labels stay consistent between read and edit views

**The pen** — shown when the active persona is `steward` (reachable by the `editor` and `admin` roles), matching the existing drawer gate exactly. Pressing it promotes the current selection into edit mode:

- the attribute form replaces the read-only body
- `startModify` is installed, making geometry draggable

These are **deliberately coupled** — one affordance, both capabilities. Splitting them would let a user drag geometry while believing they were only reading.

Cancel returns the panel to read-only with the selection and highlight intact. Save keeps the existing behaviour (`refreshLayer` then reset).

---

## §4 — One query engine, two surfaces

A single query model backs both surfaces:

```ts
interface Query {
  layers: EditableLayerKey[] | 'all';
  conditions: Condition[];
}
```

- **Filter** (drawer): `layers: [oneKey]`, N user-built conditions.
- **Search** (top bar): `layers: 'all'`, one condition `{ field: 'geographicalName', op: 'contains', value: q }`.

One `runQuery(map, query): Hit[]` replaces `searchAllLayers` as a separate concept. Every hit carries `{ layerKey, layerLabel, featureId, feature, label }`.

**Result click behaviour is identical on both surfaces:**

1. `selectById(layerKey, featureId)` → highlight
2. `view.fit(geom.getExtent(), { padding, maxZoom })` — `padding` reserves the left block's width so the feature lands in visible map, not behind the panels; `maxZoom` (≈14) prevents a point from zooming to street level
3. the detail panel opens

`view.fit` replaces the current fixed `zoom: 11` centre-on-extent. For a long MultiLineString like Sông Ba, a fixed zoom 11 lands mid-river showing no useful context; fitting the extent frames the whole feature.

**Correctness fixes folded in:**

- **Result identity.** `useFilterPresenter` currently uses the array index as the result id (`id: String(i)`) and resolves clicks with `matched[Number(id)]`. Because the presenter subscribes to source `change` events, the array can be rebuilt between render and click, flying the user to a different feature. Hits carry the real feature identity instead.
- **`eq` semantics.** `applyFilter`'s `eq` is a case-insensitive *substring* test, so enum value `xa_lu` would also match `xa_lu_khan_cap`, and the current design defends this only by arguing today's data has no collisions. Split into `contains` (text) and `eq` (exact, normalized) — the field type already tells the UI which to use.
- **Empty conditions.** `applyFilter(features, [])` returns `[]` today, encoding a display decision ("don't render everything before the user asks") in the pure core. It returns all features; the presenter applies the display cap.
- **Result cap is a display concern.** The cap (20) moves to the presenter, and the UI shows `hiển thị 20 / N` so a capped list never reads as complete.

**Known limitation, unchanged from 2.3:** queries run over features already loaded in the browser, so results reflect what the map has loaded, not the full dataset. Layers that are off contribute nothing. The result list surfaces unloaded layers as a row ("lớp chưa bật") rather than silently omitting them, so an empty result is distinguishable from an unloaded layer. Pushing predicates to GeoServer via `CQL_FILTER` is the eventual fix and is out of scope here; `runQuery` is kept behind a narrow interface so that swap does not require rewriting callers.

---

## §5 — Map view constraints

**Single source of truth.** `minZoom`/`maxZoom` are currently declared twice and disagree: `MapModel.ts:118` sets `minZoom: 4.0`, while `MapControls.tsx:17` defaults its own state to `6`, so the zoom buttons and the scroll wheel enforce different floors. Both read one shared constant.

**Extent becomes Vietnam.** `MapModel.ts:120` constrains the view to `[107.0, 10.5, 109.5, 16.5]` — a south-central coastal strip excluding the Mekong Delta, Ho Chi Minh City, Hanoi and the whole north. It becomes Vietnam's bounding box `[102.1, 8.2, 109.5, 23.4]` (EPSG:4326, transformed to EPSG:3857 as today).

**Zoom floor.** `minZoom` is set so the country fits the viewport (≈5.5, tuned during `/run`). The extent is a hard constraint: the user cannot pan or zoom outside Vietnam.

Vietnam's bbox is tall and narrow (~15° latitude vs ~7° longitude), so on a wide viewport the country fills vertically with sea and neighbouring territory visible either side. That is geometry, not a bug.

**Out of scope:** how thematic layers render at country scale. No per-layer min-zoom, no restyling for the far-out view — the base map is what the zoomed-out view is for.

---

## Architecture touchpoints

```
entities/selection/                     (new)    — Selection type, provider, selectById, highlight styles
widgets/display-panel/                  (new)    — read-only attribute panel + pen; collapse button
features/shell/model/useShellPresenter  (modify) — hasDrawer: true; role gating moves to sections
features/shell/ui/                      (modify) — drawer hosts Filter (all) + Edit (steward)
features/attribute-filter/
  model/runQuery.ts                     (new)    — unified query over layers x conditions
  model/applyFilter.ts                  (modify) — eq/contains split; empty conditions -> all
  model/useFilterPresenter.ts           (modify) — feature-identity ids; display cap; selects on click
  model/searchFeatures.ts               (delete) — subsumed by runQuery
  model/flyToGeometry.ts                (modify) — view.fit with padding + maxZoom
features/map/model/MapModel.ts          (modify) — extent -> Vietnam; shared zoom constants; rivers Select removed
features/map/model/SelectController.ts  (modify) — moves under entities/selection; gains selectById
features/map/model/mapEditing.tsx       (modify) — no longer owns selection; editing subscribes
features/feature-editing/model/useEditExistingPresenter.ts (modify) — reads selection; modify behind pen
components/SearchBar.tsx                (modify) — runQuery; identical click behaviour
components/MapControls.tsx              (modify) — reads shared zoom constants
packages/shared/                        (modify) — zoom/extent constants; FilterField op typing
```

## Testing

- **selection entity** — `selectById` selects the right feature; click and programmatic paths converge on one selection; clearing removes the highlight; selecting does not start modify.
- **editing refactor** — the existing editing tests pass unchanged (this is the pure-refactor proof); pen starts modify, cancel stops it.
- **display panel** — renders title/tag/attributes from a selection stub; pen hidden for non-steward personas; collapse hides the body while selection survives; a new selection resets the collapse flag.
- **runQuery** — one condition across all layers matches the old search behaviour; N conditions on one layer match the old filter behaviour; hits carry layer identity; unloaded layers surface as a row, not silence.
- **applyFilter** — `eq` is exact (`xa_lu` does not match `xa_lu_khan_cap`); `contains` is substring; empty conditions return all features; scale division unchanged.
- **result identity** — a hit resolves to the correct feature after the underlying array is rebuilt (regression test for the index-id bug).
- **flyToGeometry** — `view.fit` receives the geometry extent, left padding, and a maxZoom cap; null map/geom does not throw.
- **map view** — the extent constant is Vietnam's bbox; `MapModel` and `MapControls` read the same zoom floor.
- **jsdom discipline** — no reachability, overlap, or visual-position assertions. Panel/map overlap and the zoom floor are verified only in `/run`.
- **`/run`** — filter from the drawer as a viewer; click a result → highlight + fit + panel; collapse/expand with selection intact; search a name from the top bar → same behaviour; as a steward, pen → edit → save; confirm geometry is not draggable before the pen; zoom out to the whole country and confirm panning stops at the border.

## YAGNI — not doing

- No `CQL_FILTER` pushdown to GeoServer — in-memory queries stay, behind an interface that permits the swap later.
- No fuzzy or ranked search — case-insensitive substring on `geographicalName`.
- No auto-loading of off layers to satisfy a query — they are surfaced as unloaded rows instead.
- No map inset when the panels open — they overlay, with fit padding compensating.
- No per-layer min-zoom or country-scale restyling.
- No multi-select — one selection at a time.
- No OR conditions or condition grouping — AND only, unchanged from 2.3.
