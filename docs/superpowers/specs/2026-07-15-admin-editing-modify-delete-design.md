# Admin Map Editing — Modify/Move + Delete (Part 2) — Design

**Date:** 2026-07-15
**Status:** Approved design — ready for implementation planning
**Scope:** Extend the admin editing feature (Plan 7 draw-to-create) with editing **existing** features: an explicit "Edit existing" mode where the admin selects an editable feature, reshapes/moves its geometry (OpenLayers `Modify` + `Translate`) and/or edits its attributes in a pre-filled form, and saves both via `PUT`; or deletes it (with a confirm dialog) via `DELETE`. The layer refetches so changes appear live. Frontend-only — the `PUT`/`DELETE`/audit API already exists (Plan 5).

---

## 1. Context & goal

Plan 7 shipped **draw-to-create**: pick an editable layer, draw geometry, fill an attribute form, `POST`. This plan is its **Part 2**, the design's stated follow-on (admin-editing spec §9): edit and delete features that already exist.

The reusable pieces are already on `main`:

- **API (Plan 5):** admin-only `PUT /api/layers/:key/features/:id` (accepts `{ geometry?, properties }` — geometry optional; only re-validated when provided) and `DELETE /api/layers/:key/features/:id` (204). Both audited.
- **OL quarantine (`features/map/model/`):** `DrawController` (OL `Draw` + temp layer), `geo.ts` (`olGeometryTo4326GeoJSON` / `geoJSON4326ToOlGeometry`, 3857↔4326), `mapEditing.tsx` (the non-OL bridge), `MapModel` (owns the `Map`, WFS sources, and `refreshLayer`).
- **Feature slice (`features/admin-editing/`):** `useAttributeFormPresenter` (create form, DB-keyed values, ISO labels, `ApiError` mapping), the passive views, `features.api.createFeature`, the `RequireRole('admin')`-gated container.
- **Shared (`@webatlas/shared`):** `denormalizeFeatureProperties(key, isoProps)` (ISO→DB column — built in Plan 7 precisely for this edit path), `LAYER_ATTRIBUTE_MAP`, `LAYER_GEOMETRY`.

**Goal:** an authenticated admin can, in an explicit edit mode, select any feature on the 7 editable layers, change its geometry and/or attributes and save, or delete it — and see the result live via WFS refetch.

### Non-goals (deferred, YAGNI)

- Multi-feature / batch edit; snapping; undo/redo.
- Editing GADM base layers (still forbidden — they have no API write path).
- The **editable attribute labels** plan (admin-editing §9 second bullet: `app.layer_attribute_labels` + runtime label API).
- Optimistic rendering (writes refetch WFS rather than optimistically mutating, per the Plan 7 pattern).
- Any API change — `PUT`/`DELETE`/audit already exist.

---

## 2. Hard invariants (inherited from Plan 7)

- **Only the 7 editable thematic layers are editable.** Selection is scoped to editable layers only; GADM base layers can never be selected for edit or deleted.
- **Backend is the authorization boundary.** Every write goes through `apiClient` with the JWT; the API enforces admin-only. The edit mode is `RequireRole('admin')`-gated as UX only (carries the standard comment).
- **OpenLayers stays quarantined** to `features/map/model/`. No `ol/*` import in `features/admin-editing/*`, presenters, `*.view.tsx`, or `packages/shared`. The new `SelectController`/`ModifyController` live in the quarantine; the bridge exposes only plain (non-OL) types.
- **The API contract is DB-columns + EPSG:4326.** All translation (ISO→DB via `denormalizeFeatureProperties`; 3857→4326 via `geo.ts`) happens on the frontend before the request.

---

## 3. Architecture — components

### 3.1 `SelectController` (new, OL quarantine)

Owns feature selection for editing, active only while in edit mode.

- Constructed with the shared `Map`. `activate()` adds an OL `Select` (or a click hit-test) **scoped to the editable WFS layers only** (by their layersState ids, from `LAYER_REGISTRY`); `deactivate()` removes it.
- On select, reads the clicked OL feature and emits a **plain** payload via a callback: `{ layerKey: EditableLayerKey, featureId: string, geometry: GeoJSONGeometry (4326), isoProps: Record<string, unknown> }`. `featureId` comes from the WFS feature id (`f.getId()`, e.g. `dams.<uuid>` → the uuid); geometry via `olGeometryTo4326GeoJSON`; `isoProps` are the feature's already-normalized ISO properties.
- **Popup suppression:** while active, edit-mode clicks select-for-edit and do **not** open the DynamicPopup. Reconcile with the existing rivers-highlight `Select` in `MapModel` (see §3.5).

### 3.2 `ModifyController` (new, OL quarantine)

Owns geometry editing of the selected feature.

- `start(olFeatureRef)` binds OL `Modify` + `Translate` to the selected feature (moved into an editable temp source, mirroring `DrawController`'s temp-layer pattern). On any geometry change, reprojects 3857→4326 via `geo.ts` and emits the updated `GeoJSONGeometry` through an `onGeometryChange` callback.
- `cancel()` removes the interactions and restores/clears; `dispose()` mirrors `DrawController.dispose()`. One controller instance, reused across selections.

### 3.3 `mapEditing.tsx` bridge (extend)

Add **non-OL** methods to the existing `MapEditingValue` (no `ol/*` leaks to consumers):

- `enterEditMode(): void` / `exitEditMode(): void` — activate/deactivate `SelectController`, suppress/restore popup.
- `onFeatureSelected(cb: (sel: { layerKey; featureId; geometry; isoProps }) => void): void` — register the selection callback.
- `startModify(): void` / `cancelModify(): void` — drive `ModifyController` for the current selection.
- `onGeometryChange(cb: (g: GeoJSONGeometry) => void): void` — register the modify callback.

The provider lazily constructs `SelectController` + `ModifyController` alongside the existing `DrawController` (same `map` effect). All parameters/returns are plain objects — the quarantine seam holds exactly as in Plan 7.

### 3.4 Feature slice (`features/admin-editing/`, no `ol/*`)

- **`api/features.api.ts` (extend):**
  - `updateFeature(key: string, id: string, payload: { geometry?: GeoJSONGeometry; properties: Record<string, unknown> }): Promise<{ id: string }>` → `PUT /api/layers/:key/features/:id`.
  - `deleteFeature(key: string, id: string): Promise<void>` → `DELETE /api/layers/:key/features/:id` (204).
- **`model/useEditExistingPresenter.ts` (new):** the edit-existing view-model + handlers. `mode: 'idle' | 'selecting' | 'editing'`; holds `selected: { layerKey, featureId } | null`, the working geometry (seeded from the selection, updated by `onGeometryChange`), and delete-confirm open state. Handlers: `enterEditMode`/`exitEditMode`, `onSelected` (pre-fills the form + starts modify), `requestDelete`/`confirmDelete`/`cancelDelete`, and delegates save to the attribute-form presenter (edit mode). On save/delete success → `refreshLayer(layerStateId)` + reset.
- **`model/useAttributeFormPresenter.ts` (extend, not fork):** add an optional `initialValues?: Record<string,string>` and a `mode: 'create' | 'edit'` (or an injected `onSubmit`). In `edit` mode: `values` seed from `initialValues` (built via `denormalizeFeatureProperties` on the selection's `isoProps`), `canSave` allows attribute-only saves (geometry optional on update), and submit calls `updateFeature(key, id, …)`. The create path is unchanged. This keeps one form for both flows (design §9 "reuses this plan's form").
- **`ui/`:**
  - `EditModeToggle.view.tsx` (new) — passive enter/exit-edit-mode control + a hint ("Click a feature to edit").
  - Reuse `AttributeForm.view` for the pre-filled edit form; add a **Delete** button + a `ConfirmDialog` (in `shared/ui`, dumb) for the delete confirmation ("Delete this feature? This cannot be undone.").
  - Container `index.tsx` (extend) — wire the edit-existing presenter + views under the same `RequireRole('admin')` gate, alongside the existing draw-to-create toolbar.

### 3.5 `Select` reconciliation (MapModel)

`MapModel` already adds a `Select` interaction on the rivers layer for click-highlight. The new edit `SelectController` must not double-fire with it or the DynamicPopup singleclick handler:

- The edit `Select` is added only in edit mode and removed on exit.
- While edit mode is active, the DynamicPopup's singleclick→popup is suppressed (a flag the bridge/MapModel exposes, or the popup checks an "editing" state).
- The rivers-highlight `Select` and the edit `Select` are scoped to different layer sets / modes; verify in tests + `/run` that entering edit mode doesn't leave the highlight select firing on the same click.

---

## 4. Data flow (modify/delete)

1. Admin (logged in) toggles **Edit existing** → `enterEditMode()` activates `SelectController` (editable layers only), popup suppressed.
2. Admin clicks an editable feature → `SelectController` emits `{ layerKey, featureId, geometry (4326), isoProps }`.
3. Presenter pre-fills the attribute form (`denormalizeFeatureProperties(layerKey, isoProps)` → DB-keyed values) and calls `startModify()` → `ModifyController` binds Modify/Translate to the feature. `mode = 'editing'`.
4. Admin reshapes/moves the geometry (each change → `onGeometryChange` updates the working 4326 geometry) and/or edits attribute fields.
5. **Save:** the form presenter builds `{ geometry?: workingGeometry, properties: { db_col: value } }` and calls `updateFeature(layerKey, featureId, payload)` → `PUT` (JWT). Geometry is included only if the admin modified it (attribute-only save otherwise).
6. On **200:** clear interactions + selection, close the form, `refreshLayer(layerStateId)` so the change renders live.
7. **Delete:** admin clicks **Delete** in the edit panel → `ConfirmDialog` → confirm → `deleteFeature(layerKey, featureId)` → `DELETE` → on **204**, clear selection + `refreshLayer`.

**Cancel/exit** at any stage removes the interactions, clears the selection, and restores normal click→popup. A page refresh discards any unsaved edit.

---

## 5. Error handling

- API errors → `apiClient` → typed `ApiError`; the form presenter's existing mapping applies (400 field/form errors from Zod `flatten()`, 422 geometry, 401→logout, 403→toast). Add **404** (feature deleted concurrently) → "This feature no longer exists" + refetch.
- **Delete** failure → toast; the feature stays. Delete success but refetch failure → toast; the row is already gone server-side, a manual refresh recovers (mirrors Plan 7 §5).
- **Guardrails:** Save is disabled until there is something to save (geometry changed OR at least one attribute present — but since attributes are nullable, an edit with no changes is a harmless no-op PUT; keep Save enabled once a feature is selected). Modify only permits editing the selected feature's own geometry type.

---

## 6. Testing (mirrors Plan 7 §6)

- **Presenters** (`useEditExistingPresenter`, extended `useAttributeFormPresenter`) — pure hooks with mocked bridge + mocked `features.api`: select → form pre-filled (DB-keyed, from `denormalize`), modify → working geometry updated, save → `updateFeature` called with `{geometry?, properties}`, delete flow (request→confirm→`deleteFeature`), `ApiError` mapping incl. 404.
- **Views** — `EditModeToggle` (enter/exit), `ConfirmDialog` (confirm/cancel callbacks), `AttributeForm` in edit mode (renders pre-filled values, save enabled).
- **`SelectController`** — against an OL double: activate adds the interaction scoped to editable layers; on select emits the plain payload (layerKey/featureId/4326 geometry/isoProps); deactivate removes it; popup suppressed while active.
- **`ModifyController`** — OL double: `start` adds Modify+Translate; a geometry change emits 4326 GeoJSON; cancel/dispose remove the interactions.
- **`updateFeature`/`deleteFeature`** (api) — mocked `apiRequest`: correct method/path/body; returns.
- **Manual `/run`** — enter edit mode, select a dam, move it + edit `geographicalName`, save, confirm via WFS refetch; delete a `@webatlas.test` row and confirm it disappears.

---

## 7. Convention rules (enforced in review/lint)

1. No `ol/*` import outside `features/map/model/` (`SelectController`/`ModifyController` live there).
2. `*.view.tsx` import no `apiClient`/session-api/`ol/*`/`features/map/model` — props only.
3. Presenters return a view-model + handlers; no JSX, no `fetch`, no `ol/*`.
4. Only Models touch `apiClient` (`features.api.ts`) and OpenLayers.
5. Edit mode is `RequireRole('admin')`-gated (UX only; carries the "backend enforces" comment).
6. Selection is scoped to the editable-layer set only — never a base layer.

---

## 8. Scope boundaries (YAGNI — deferred)

- Editable attribute labels (runtime dictionary) → the separate labels plan.
- Multi-feature batch edit, snapping, undo/redo, optimistic rendering.
- Any new API endpoint (PUT/DELETE already exist).
- Editor/viewer-role editing semantics (only admin is exercised).

---

## 9. Follow-on

- **Editable labels plan** — `app.layer_attribute_labels` table + admin GET/PUT API + runtime label fetch; the attribute form swaps its label source from `LAYER_ATTRIBUTE_MAP` to the API with no change to the DB-keyed save path (works for both create and edit).
- **Selection UX polish** — hover highlight of the hit feature before click; a small "editing this feature" chip; snapping to nearby vertices.
