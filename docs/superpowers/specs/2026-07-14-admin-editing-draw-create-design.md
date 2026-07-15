# Admin Map Editing — Draw-to-Create (Part 1) — Design

**Date:** 2026-07-14
**Status:** Approved design — ready for implementation planning
**Scope:** Add admin **create-a-feature** editing to the React + OpenLayers frontend: pick an editable layer, draw its geometry, fill a schema-driven attribute form, and save to the Plan 5 feature-CRUD API. Modify/move and delete are a separate follow-on. Builds on the Plan 6 auth/session layer and the Plan 5 API.

---

## 1. Context & goal

The pieces this depends on already exist:

- **API (Plan 5):** `GET /api/layers` (catalog of the 7 editable layers + geometry types), and admin-only `POST /api/layers/:key/features` accepting a GeoJSON feature `{ geometry, properties }` in **EPSG:4326** with **DB-column** attribute names; validates geometry in PostGIS, audits the write.
- **Auth (Plan 6):** `apiClient` (attaches the JWT, normalizes errors to `ApiError`, 401→logout / 403→keep), `useSession`, and `RequireRole` (UX gate).
- **Frontend map:** `MapModel` owns the OpenLayers `Map` and WFS layers; all `ol/*` code is quarantined to `features/map/model/`. WFS features are displayed with **ISO/INSPIRE attribute names** (via `normalizeFeatureProperties`) and geometry reprojected to **EPSG:3857**.
- **Shared (`@webatlas/shared`):** `EDITABLE_LAYER_KEYS`, `LAYER_GEOMETRY`, `LAYER_ATTRIBUTE_MAP` (DB-column → ISO name per layer), `normalizeFeatureProperties`.

**Goal:** an authenticated admin can add a new feature to any of the 7 editable thematic layers, and see it appear live after save. Milestone: pick layer → draw → attribute form → save → the feature is fetched back via WFS.

### Non-goals (deferred)

- Modify/move existing geometry, and delete — the **next** editing plan.
- Editing existing features' attributes (this plan is create-only; edit-existing reuses this plan's form + translation in the next plan).
- Admin-editable attribute **labels** (the label dictionary stays the compile-time `LAYER_ATTRIBUTE_MAP` constant; making it runtime-editable is a separate later plan).
- User-management UI.

---

## 2. Hard invariants

- **Only the 7 editable thematic layers are editable.** The toolbar's layer picker is sourced exclusively from `GET /api/layers` (equivalently `EDITABLE_LAYER_KEYS`). The **GADM base/boundary layers** (`layer_provinces_2026`, `layer_wards_2026`) are static reference files, are not in `EDITABLE_LAYER_KEYS`, and have no API write path — they can never appear in the picker or be edited.
- **Backend is the authorization boundary.** Every write goes through `apiClient` with the JWT; the API enforces admin-only. `RequireRole('admin')` gating the toolbar is UX only (carries the standard comment), not a security control.
- **OpenLayers stays quarantined** to `features/map/model/`. No `ol/*` import appears in `features/admin-editing/*`, in presenters, in `*.view.tsx`, or in `packages/shared`.
- **The API contract is DB-columns + EPSG:4326.** All translation (ISO→DB attribute names, 3857→4326 geometry) happens on the frontend before the request.

---

## 3. Architecture — FSD + MVP, one file per tool

```
apps/web/src/
  features/admin-editing/
    model/
      useEditToolbarPresenter.ts     # toolbar view-model: editable-layer list, selected layer, mode (idle|drawing|form)
      useDrawToolPresenter.ts        # draw view-model: startDraw/cancel, pendingGeometry (4326 GeoJSON | null)
      useAttributeFormPresenter.ts   # form view-model: field values (DB-keyed), validation, submit
    ui/
      EditToolbar.view.tsx           # passive toolbar shell
      LayerPicker.view.tsx           # passive: the 7 editable-layer selector
      DrawControls.view.tsx          # passive: draw / cancel controls + hint text
      AttributeForm.view.tsx         # passive: maps a layer's attributes to a list of AttributeField
      AttributeField.view.tsx        # passive: one field (ISO label + input), reused per attribute
    api/
      features.api.ts                # createFeature(key, { geometry, properties }) via apiRequest
    index.tsx                        # container; RequireRole('admin')-gated; wires presenters -> views
  features/map/model/
    DrawController.ts                # owns the OL Draw interaction + a temporary edit VectorSource/Layer
    geo.ts                           # OL-quarantined geometry helpers: reproject 3857<->4326, OL geom <-> GeoJSON
    MapModel.ts                      # (extend) expose the Map + a hook so DrawController shares the one Map instance
packages/shared/src/
    layer-attributes.ts             # (extend) denormalizeFeatureProperties(key, isoProps) -> { db_col: value }
```

**MVP roles:** Model = `DrawController`/`geo.ts`/`MapModel` (the only `ol/*` touchers) + `features.api.ts` + the session/apiClient layer (the only `apiClient` touchers). Presenter = the three `use*Presenter` hooks (view-model + handlers, no JSX/fetch/ol). View = the `*.view.tsx` (props only). Container = `index.tsx` (wiring + `RequireRole` gate).

### 3.1 `DrawController` (new, in the OL quarantine)

Owns editing OL state, separate from `MapModel` so the base map class stays focused. Interface:

- `startDraw(geomType: OgcGeometryType, onFinish: (geometry: GeoJSONGeometry) => void): void` — adds a temporary `VectorLayer`/`VectorSource` and an OL `Draw` interaction configured for `geomType` (Point / LineString→wrapped / Polygon→wrapped to match the layer's Multi type). On `drawend`, reads the sketch geometry, reprojects **3857→4326** and converts to a plain GeoJSON geometry via `geo.ts`, then calls `onFinish` with that plain object.
- `cancel(): void` — removes the interaction + temp layer, discards the sketch.
- Holds the reference to the shared OL `Map` obtained from `MapModel` (one Map instance; `DrawController` does not create its own).

### 3.2 `geo.ts` (new, in the OL quarantine)

Small pure helper module (imports `ol/proj`, `ol/format/GeoJSON`) so reprojection/format code is testable and reused by Plan 8. Functions: `olGeometryTo4326GeoJSON(geom)` and (for later) `geoJSON4326ToOlGeometry(geojson)`. Kept in `features/map/model/` because it touches `ol/*`; it must NOT live in `shared/` (which stays OL-free).

### 3.3 `denormalizeFeatureProperties` (extend `@webatlas/shared`)

The inverse of the existing `normalizeFeatureProperties`: given a layer key and an ISO-named property object, return `{ db_column: value }` using `LAYER_ATTRIBUTE_MAP`. Pure, OL-free, shared by API/web. A round-trip (`normalize` then `denormalize`) returns the original DB props. Note: the attribute **form** is keyed by DB column internally and displays ISO labels, so in practice the form emits DB-keyed values directly; `denormalizeFeatureProperties` exists for any ISO-named input path and to keep the mapping bidirectional and tested.

---

## 4. Data flow (draw-to-create)

1. Admin (logged in) opens the edit toolbar (`RequireRole('admin')`). `LayerPicker` lists only the editable layers from `GET /api/layers`.
2. Admin selects a layer → `useDrawToolPresenter` calls into `MapModel`/`DrawController.startDraw(geomType, onFinish)`. A temp edit layer + OL `Draw` (for that geometry type) is active.
3. Admin draws. **While drawing, the geometry lives only in the ephemeral OL temp `VectorSource` inside `DrawController` (EPSG:3857)** — not in React, not persisted.
4. On finish, `DrawController` reprojects to **4326**, converts to a **plain GeoJSON geometry object**, and calls `onFinish(geometry)`. From here the pending geometry is a plain JS object held by the presenter — still in-memory, not saved.
5. `AttributeForm` opens, scoped to the layer's attributes (`AttributeField` per attribute; ISO labels, DB-column keys). Admin fills fields.
6. `useAttributeFormPresenter.submit()` builds `{ geometry, properties: { db_col: value, … } }` → `features.api.createFeature(key, payload)` → `apiClient` `POST /api/layers/:key/features` (JWT attached).
7. On **201**: `DrawController.cancel()` clears the temp sketch, the form closes, and the layer's WFS source is **refetched** (refresh the OL WFS `VectorSource` for that layer / invalidate its TanStack Query) so the new feature renders live.

**Cancel** at any stage removes the interaction + temp layer and resets presenter state. A page refresh discards any unsaved draw.

---

## 5. Error handling

- API errors → `apiClient` → typed `ApiError`; the form presenter maps them: **400 VALIDATION_ERROR** → field/form message (from `error.details`); **422 GEOMETRY_ERROR** → "Invalid geometry" near the map; **409 CONFLICT** → "Already exists"; **401** → apiClient logs out (session expired); **403** → "no permission" toast (unexpected for a real admin).
- **Draw guardrails:** the tool only permits the selected layer's geometry type, so a shape mismatch cannot be drawn; save is disabled until a geometry has been finished (`pendingGeometry !== null`).
- **Refetch failure** after a successful write → toast; the feature is already saved server-side, so a manual layer refresh recovers.

---

## 6. Testing (design §7.3, §11)

- **Presenters** (`useEditToolbarPresenter`, `useDrawToolPresenter`, `useAttributeFormPresenter`) — pure hooks with a mocked MapModel/DrawController + mocked `features.api`: layer selection, draw start → `pendingGeometry` set on finish, form submit success (calls API with DB-keyed payload + 4326 geometry) and failure (maps `ApiError`).
- **Views** — render with hand-built props (no network/map): `LayerPicker` lists exactly the editable layers; `AttributeField` renders an ISO label + input and calls `onChange`; `AttributeForm` maps a layer's attributes to fields and enables save only when valid + geometry present.
- **`DrawController`** — against an OL test double (as `MapModel`'s existing tests do): `startDraw` adds the interaction for the right geometry type; the finish path reprojects 3857→4326 and emits GeoJSON; `cancel` removes the interaction + temp layer.
- **`geo.ts`** — unit test the 3857↔4326 reprojection + GeoJSON conversion on known coordinates.
- **`denormalizeFeatureProperties`** (shared) — round-trip test with `normalizeFeatureProperties` for each of the 7 layers.
- **Manual `/run`** — log in, pick a layer, draw + fill + save a feature named with the `@webatlas.test` sentinel, confirm it appears via WFS refetch, then delete the test row.

---

## 7. Convention rules (enforced in review/lint)

1. No `ol/*` import outside `features/map/model/` (existing quarantine; `DrawController.ts` and `geo.ts` live there).
2. `*.view.tsx` import no `apiClient`/session-api/`ol/*`/`features/map/model` — props only.
3. Presenters return a view-model + handlers; no JSX, no `fetch`, no `ol/*`.
4. Only Models touch `apiClient` (`features.api.ts`) and OpenLayers (`features/map/model`).
5. `index.tsx` is wiring + `RequireRole('admin')` only; the gate carries the "backend enforces; this is UX" comment.
6. The layer picker is sourced only from the editable-layer catalog — never a hardcoded list that could include a base layer.

---

## 8. Scope boundaries (YAGNI — deferred)

- Modify/move geometry + delete → the next editing plan.
- Edit-existing-feature attributes → next plan (reuses this plan's form + translation + `PUT`).
- Admin-editable attribute labels (runtime dictionary) → separate later plan.
- Snapping, undo/redo, multi-feature batch edits, optimistic rendering (writes refetch WFS rather than optimistically mutating, per design §9).

---

## 9. Follow-on

- **Next editing plan** — select an existing WFS feature → `Modify`/`Translate` geometry and/or edit attributes in the same form → `PUT /api/layers/:key/features/:id`; delete → `DELETE …`; all reusing `DrawController`/`geo.ts`, the attribute form, and the translation helpers from this plan.
- **Editable labels plan** — `app.layer_attribute_labels` table + admin GET/PUT API + runtime label fetch; the form swaps its label source from `LAYER_ATTRIBUTE_MAP` to the API with no change to the DB-keyed save path.
