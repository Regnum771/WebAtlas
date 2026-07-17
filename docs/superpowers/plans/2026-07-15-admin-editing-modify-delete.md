# Admin Map Editing — Modify/Move + Delete (Part 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated admin, in an explicit "Edit existing" mode, select a feature on the 7 editable layers, reshape/move its geometry (OpenLayers `Modify` + `Translate`) and/or edit its attributes in a pre-filled form and save via `PUT`, or delete it (with a confirm dialog) via `DELETE` — with the layer refetched so changes appear live.

**Architecture:** Feature-Sliced Design + MVP, extending Plan 7. Two new OpenLayers-quarantined controllers — `SelectController` (feature selection scoped to editable layers, edit-mode only) and `ModifyController` (Modify/Translate on the selected feature) — plus an extension of the non-OL `mapEditing` bridge exposing plain `enterEditMode`/`exitEditMode`/`onFeatureSelected`/`startModify`/`onGeometryChange`/`editing`. The attribute-form presenter is **extended, not forked** (create + edit modes). Selection payloads and geometry cross the seam as plain objects; the OL feature stays inside the quarantine. The API `PUT`/`DELETE`/audit already exist (Plan 5) — this is frontend-only.

**Tech Stack:** React 19, TypeScript (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`/`noUnusedParameters`), OpenLayers 10, `@webatlas/shared`, the Plan 6 `apiClient`, Vitest + `@testing-library/react` + jsdom.

## Global Constraints

- Node 22 / npm 10 workspaces. All work in `apps/web`. Base branch: current `main` (Plan 7 + map-perf merged).
- **API contract (verified on main):** `PUT /api/layers/:key/features/:id` accepts `{ geometry?, properties? }` (same `FeatureBody` schema as create; geometry optional, re-validated only when present) → `{ feature: { id, ... } }`. `DELETE /api/layers/:key/features/:id` → **204**. Both admin-only (JWT), both audited.
- **Hard invariants (design §2):**
  1. **Only the 7 editable layers are editable.** Selection is scoped to the editable WFS layers only (their layersState ids from `LAYER_REGISTRY`); GADM base layers can never be selected/deleted.
  2. **Backend is the authorization boundary.** Every write goes through `apiRequest` (JWT). Edit mode is `RequireRole('admin')`-gated as UX only (carry the comment).
  3. **OpenLayers stays quarantined** to `apps/web/src/features/map/model/`. No `ol/*` in `features/admin-editing/*`, presenters, `*.view.tsx`, `shared`, or `DynamicPopup`/`DynamicLegend`. `SelectController`/`ModifyController` live in the quarantine; the bridge exposes only plain types.
  4. **API contract is DB-columns + EPSG:4326.** ISO→DB via `denormalizeFeatureProperties(key, isoProps)`; 3857→4326 via `geo.ts`. All translation on the frontend before the request.
- **Reused, already on main:** `geo.ts` (`olGeometryTo4326GeoJSON`, `type GeoJSONGeometry`), `DrawController` (pattern to mirror), `mapEditing.tsx` (bridge to extend), `MapModel.refreshLayer`, `useAttributeFormPresenter` (to extend), `AttributeForm.view`/`AttributeField.view`, `features.api.createFeature`, `LAYER_REGISTRY`, `LAYER_ATTRIBUTE_MAP`, `denormalizeFeatureProperties(layerKey, isoProps): Record<string, unknown>`, `LAYER_GEOMETRY`.
- **MVP layering (design §7):** `*.view.tsx` props-only (no `apiClient`/`ol/*`/`features/map/model`); presenters return view-model + handlers, no JSX/fetch/`ol/*`; only Models touch `apiClient`/OpenLayers; container is wiring + `RequireRole` only.
- **TS constraints:** `verbatimModuleSyntax` (type-only imports use `import type`), `erasableSyntaxOnly` (no enums / no constructor parameter-properties — assign in the body), `noUnusedLocals`/`noUnusedParameters`, `jsx: react-jsx`.
- **Verification gotcha:** bare `tsc -p tsconfig.json` in `apps/web` checks NOTHING (`"files": []`). Type-check with `npm run build:web`.
- **Test/data hygiene:** no automated test hits the real API/GeoServer (all mock `fetch`/bridge). Manual `/run` uses `@webatlas.test` features and cleans them up.

## Directory layout (new/changed files)

```
apps/web/src/
  features/map/model/
    SelectController.ts          # (create) OL Select scoped to editable layers; emits plain selection payload
    SelectController.test.ts     # (create)
    ModifyController.ts          # (create) OL Modify+Translate on the selected feature; emits 4326 GeoJSON
    ModifyController.test.ts     # (create)
    mapEditing.tsx               # (modify) extend bridge: edit-mode/select/modify/editing; own Select+Modify controllers
    mapEditing.test.tsx          # (modify) add delegation tests for the new methods
  features/admin-editing/
    api/features.api.ts          # (modify) add updateFeature + deleteFeature
    api/features.api.test.ts     # (modify) add tests
    model/useAttributeFormPresenter.ts       # (modify) add initialValues + mode create|edit (PUT on edit)
    model/useAttributeFormPresenter.test.ts  # (modify) add edit-mode tests
    model/useEditExistingPresenter.ts        # (create) select->prefill->modify->save(PUT)/delete(DELETE)
    model/useEditExistingPresenter.test.ts   # (create)
    ui/EditModeToggle.view.tsx   # (create) passive enter/exit-edit control + hint
    ui/EditModeToggle.view.test.tsx # (create)
    index.tsx                    # (modify) wire edit-existing presenter + views + ConfirmDialog
  shared/ui/
    ConfirmDialog.tsx            # (create) dumb confirm dialog (reuses Modal)
  components/
    DynamicPopup.tsx             # (modify) suppress singleclick popup while editing (useMapEditing().editing)
```

---

### Task 1: `updateFeature` + `deleteFeature` (features.api)

**Files:**
- Modify: `apps/web/src/features/admin-editing/api/features.api.ts`
- Modify: `apps/web/src/features/admin-editing/api/features.api.test.ts`

**Interfaces:**
- Consumes: `apiRequest` (Plan 6), `GeoJSONGeometry` (from `mapEditing`).
- Produces:
  - `interface UpdateFeaturePayload { geometry?: GeoJSONGeometry; properties: Record<string, unknown> }`.
  - `updateFeature(key: string, id: string, payload: UpdateFeaturePayload): Promise<{ id: string }>` — `PUT /api/layers/:key/features/:id`; returns `{ id: body.feature.id }`.
  - `deleteFeature(key: string, id: string): Promise<void>` — `DELETE /api/layers/:key/features/:id`; resolves on 204 (apiRequest returns undefined for 204).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/admin-editing/api/features.api.test.ts` (keep the existing `createFeature` test):
```ts
import { updateFeature, deleteFeature } from './features.api';

describe('updateFeature', () => {
  it('PUTs geometry + properties to :id and returns the id', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ feature: { id: 'u1' } });
    const payload = { geometry: { type: 'Point', coordinates: [108, 13] }, properties: { name: 'X' } };
    const out = await updateFeature('dams', 'u1', payload);
    expect(out).toEqual({ id: 'u1' });
    const [path, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/layers/dams/features/u1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('PUTs attribute-only (no geometry) when geometry omitted', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ feature: { id: 'u2' } });
    await updateFeature('rivers', 'u2', { properties: { name: 'R' } });
    const [, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ properties: { name: 'R' } });
  });
});

describe('deleteFeature', () => {
  it('DELETEs :id and resolves', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await deleteFeature('dams', 'd1');
    const [path, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/layers/dams/features/d1');
    expect(init.method).toBe('DELETE');
  });
});
```
(The existing test file already imports `apiRequest` mocked and `createFeature`; reuse those imports — add `updateFeature, deleteFeature` to the existing `import { createFeature } from './features.api'` line instead of a duplicate import if the linter complains.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/api/features.api.test.ts`
Expected: FAIL — `updateFeature`/`deleteFeature` are not exported.

- [ ] **Step 3: Implement**

Append to `apps/web/src/features/admin-editing/api/features.api.ts`:
```ts
export interface UpdateFeaturePayload {
  geometry?: GeoJSONGeometry;
  properties: Record<string, unknown>;
}

export async function updateFeature(key: string, id: string, payload: UpdateFeaturePayload): Promise<{ id: string }> {
  const body = await apiRequest<{ feature: { id: string } }>(`/api/layers/${key}/features/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return { id: body.feature.id };
}

export async function deleteFeature(key: string, id: string): Promise<void> {
  await apiRequest<void>(`/api/layers/${key}/features/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/api/features.api.test.ts`
Expected: all (existing + 3 new) pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin-editing/api/features.api.ts apps/web/src/features/admin-editing/api/features.api.test.ts
git commit -m "feat(web): features.api updateFeature (PUT) + deleteFeature (DELETE)"
```

---

### Task 2: `SelectController` — OL feature selection for editing

**Files:**
- Create: `apps/web/src/features/map/model/SelectController.ts`, `apps/web/src/features/map/model/SelectController.test.ts`

**Interfaces:**
- Consumes: `ol/Map`, `ol/interaction/Select`, `olGeometryTo4326GeoJSON` + `GeoJSONGeometry` (`./geo`), `EditableLayerKey` (`@webatlas/shared`).
- Produces:
  - `interface EditSelection { layerKey: EditableLayerKey; featureId: string; geometry: GeoJSONGeometry; isoProps: Record<string, unknown>; }`
  - `class SelectController` constructed with `(map: Map, editableLayerStateIds: Record<string, EditableLayerKey>)` — a map of layersState id → layer key, so it can scope selection to editable layers and know which key was hit.
  - `activate(onSelect: (sel: EditSelection) => void): void` — adds an OL `Select` limited to the editable layers; on select, reads the feature's `getId()` (strips the `typename.` prefix → the uuid), geometry (`olGeometryTo4326GeoJSON`), and non-geometry props (the ISO-named set already on the WFS feature), and calls `onSelect`. Holds the selected OL feature internally (for `ModifyController`).
  - `getSelectedFeature(): Feature | null` — the currently selected OL feature (used by `ModifyController`; stays inside the quarantine).
  - `clear(): void` — clears the OL selection + internal ref. `deactivate(): void` — `clear()` + removes the interaction. `dispose(): void` — `deactivate()`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/SelectController.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import Select from 'ol/interaction/Select';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { SelectController } from './SelectController';

// jsdom lacks ResizeObserver (OL Map needs it).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

function makeMap(): { map: Map; damsLayer: VectorLayer<VectorSource> } {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  const damsLayer = new VectorLayer({ source: new VectorSource(), properties: { id: 'layer_dams' } });
  const map = new Map({ target: el, layers: [damsLayer], view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
  return { map, damsLayer };
}

function selectInteractions(map: Map): Select[] {
  return map.getInteractions().getArray().filter((i): i is Select => i instanceof Select);
}

describe('SelectController', () => {
  let map: Map; let damsLayer: VectorLayer<VectorSource>; let ctrl: SelectController;
  beforeEach(() => {
    ({ map, damsLayer } = makeMap());
    ctrl = new SelectController(map, { layer_dams: 'dams' });
  });
  afterEach(() => { ctrl.dispose(); map.setTarget(undefined); });

  it('activate adds a Select interaction; deactivate removes it', () => {
    ctrl.activate(() => {});
    expect(selectInteractions(map)).toHaveLength(1);
    ctrl.deactivate();
    expect(selectInteractions(map)).toHaveLength(0);
  });

  it('on select emits a plain EditSelection (layerKey, featureId, 4326 geometry, isoProps)', () => {
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    const feature = new Feature({ geometry: new Point(fromLonLat([108.2, 13.5])), geographicalName: 'Dam A' });
    feature.setId('dams.abc-123');
    damsLayer.getSource()!.addFeature(feature);
    // Drive the Select interaction's select event directly.
    const select = selectInteractions(map)[0];
    select.getFeatures().push(feature);
    select.dispatchEvent({ type: 'select', selected: [feature], deselected: [] } as never);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const sel = onSelect.mock.calls[0][0];
    expect(sel.layerKey).toBe('dams');
    expect(sel.featureId).toBe('abc-123'); // typename prefix stripped
    expect(sel.geometry.type).toBe('Point');
    expect(sel.geometry.coordinates[0]).toBeCloseTo(108.2, 3);
    expect(sel.isoProps.geographicalName).toBe('Dam A');
    expect(ctrl.getSelectedFeature()).toBe(feature);
  });

  it('clear resets the selected feature', () => {
    const onSelect = vi.fn();
    ctrl.activate(onSelect);
    const feature = new Feature({ geometry: new Point(fromLonLat([108, 13])) });
    feature.setId('dams.x');
    const select = selectInteractions(map)[0];
    select.dispatchEvent({ type: 'select', selected: [feature], deselected: [] } as never);
    ctrl.clear();
    expect(ctrl.getSelectedFeature()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/SelectController.test.ts`
Expected: FAIL — cannot find module `./SelectController`.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/map/model/SelectController.ts`:
```ts
import type Map from 'ol/Map';
import Select from 'ol/interaction/Select';
import type { SelectEvent } from 'ol/interaction/Select';
import type Feature from 'ol/Feature';
import type BaseLayer from 'ol/layer/Base';
import type { EditableLayerKey } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

export interface EditSelection {
  layerKey: EditableLayerKey;
  featureId: string;
  geometry: GeoJSONGeometry;
  isoProps: Record<string, unknown>;
}

export class SelectController {
  private map: Map;
  private layerKeyByStateId: Record<string, EditableLayerKey>;
  private select: Select | null = null;
  private selected: Feature | null = null;

  constructor(map: Map, layerKeyByStateId: Record<string, EditableLayerKey>) {
    this.map = map;
    this.layerKeyByStateId = layerKeyByStateId;
  }

  activate(onSelect: (sel: EditSelection) => void): void {
    this.deactivate();
    const editableIds = new Set(Object.keys(this.layerKeyByStateId));
    const select = new Select({
      // Only hit-test the editable WFS layers.
      layers: (layer: BaseLayer) => editableIds.has(layer.get('id')),
    });
    select.on('select', (evt: SelectEvent) => {
      const feature = evt.selected[0];
      if (!feature) { this.selected = null; return; }
      this.selected = feature;
      // Which editable layer? The Select event carries no layer, so read it from the
      // feature's layer via the map's forEachFeatureAtPixel is unavailable here; instead
      // derive the key from the feature id's typename prefix (e.g. "dams.<uuid>").
      const rawId = String(feature.getId() ?? '');
      const dot = rawId.indexOf('.');
      const featureId = dot >= 0 ? rawId.slice(dot + 1) : rawId;
      const typename = dot >= 0 ? rawId.slice(0, dot) : '';
      const layerKey = this.resolveLayerKey(typename);
      if (!layerKey) return;
      const geom = feature.getGeometry();
      if (!geom) return;
      const geometry = olGeometryTo4326GeoJSON(geom);
      const geomKey = feature.getGeometryName();
      const isoProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(feature.getProperties())) {
        if (k !== geomKey) isoProps[k] = v;
      }
      onSelect({ layerKey, featureId, geometry, isoProps });
    });
    this.map.addInteraction(select);
    this.select = select;
  }

  // Map a WFS typename (e.g. "dams") to the editable layer key. WFS ids are
  // "<typename>.<uuid>" where typename matches the layer key for the 7 layers.
  private resolveLayerKey(typename: string): EditableLayerKey | null {
    const values = Object.values(this.layerKeyByStateId);
    return (values as string[]).includes(typename) ? (typename as EditableLayerKey) : null;
  }

  getSelectedFeature(): Feature | null {
    return this.selected;
  }

  clear(): void {
    this.select?.getFeatures().clear();
    this.selected = null;
  }

  deactivate(): void {
    this.clear();
    if (this.select) {
      this.map.removeInteraction(this.select);
      this.select = null;
    }
  }

  dispose(): void {
    this.deactivate();
  }
}
```
Note: WFS feature ids are `"<typename>.<uuid>"` and for the 7 editable layers the typename equals the layer key (e.g. `dams.<uuid>`), so `resolveLayerKey` maps typename→key directly. The test's `dams.abc-123` exercises this.

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/SelectController.test.ts`
Expected: 3 tests pass. (If `SelectEvent` type import fails under this OL version, it is `import type` — keep it so; if it truly doesn't resolve, import the event type inline as `Select['on']`-compatible `any` and note it.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/SelectController.ts apps/web/src/features/map/model/SelectController.test.ts
git commit -m "feat(web): SelectController - edit-mode feature selection scoped to editable layers"
```

---

### Task 3: `ModifyController` — Modify/Translate on the selected feature

**Files:**
- Create: `apps/web/src/features/map/model/ModifyController.ts`, `apps/web/src/features/map/model/ModifyController.test.ts`

**Interfaces:**
- Consumes: `ol/Map`, `ol/interaction/Modify`, `ol/interaction/Translate`, `ol/Collection`, `ol/Feature`, `olGeometryTo4326GeoJSON` + `GeoJSONGeometry` (`./geo`).
- Produces:
  - `class ModifyController` constructed with `(map: Map)`.
  - `start(feature: Feature, onChange: (geometry: GeoJSONGeometry) => void): void` — binds OL `Modify` + `Translate` to a Collection containing `feature`; on either interaction's geometry change (`modifyend` / `translateend`), reprojects 3857→4326 and calls `onChange`. Starting again first cancels the prior.
  - `cancel(): void` — removes both interactions. `dispose(): void` — `cancel()`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/ModifyController.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { ModifyController } from './ModifyController';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}
function makeMap(): Map {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}
function interactionsOfType(map: Map, C: unknown): unknown[] {
  return map.getInteractions().getArray().filter((i) => i instanceof (C as never));
}

describe('ModifyController', () => {
  let map: Map; let ctrl: ModifyController;
  beforeEach(() => { map = makeMap(); ctrl = new ModifyController(map); });
  afterEach(() => { ctrl.dispose(); map.setTarget(undefined); });

  it('start adds Modify + Translate interactions', () => {
    const f = new Feature(new Point(fromLonLat([108, 13])));
    ctrl.start(f, () => {});
    expect(interactionsOfType(map, Modify)).toHaveLength(1);
    expect(interactionsOfType(map, Translate)).toHaveLength(1);
  });

  it('on translateend emits the moved geometry as 4326 GeoJSON', () => {
    const f = new Feature(new Point(fromLonLat([108, 13])));
    const onChange = vi.fn();
    ctrl.start(f, onChange);
    const translate = interactionsOfType(map, Translate)[0] as Translate;
    f.getGeometry()!.setCoordinates(fromLonLat([109.0, 14.0]));
    translate.dispatchEvent({ type: 'translateend', features: { getArray: () => [f] } } as never);
    expect(onChange).toHaveBeenCalledTimes(1);
    const gj = onChange.mock.calls[0][0];
    expect(gj.type).toBe('Point');
    expect(gj.coordinates[0]).toBeCloseTo(109.0, 2);
    expect(gj.coordinates[1]).toBeCloseTo(14.0, 2);
  });

  it('cancel removes both interactions', () => {
    ctrl.start(new Feature(new Point(fromLonLat([108, 13]))), () => {});
    ctrl.cancel();
    expect(interactionsOfType(map, Modify)).toHaveLength(0);
    expect(interactionsOfType(map, Translate)).toHaveLength(0);
  });

  it('starting again cancels the prior (no interaction leak)', () => {
    ctrl.start(new Feature(new Point(fromLonLat([108, 13]))), () => {});
    ctrl.start(new Feature(new Point(fromLonLat([108, 13]))), () => {});
    expect(interactionsOfType(map, Modify)).toHaveLength(1);
    expect(interactionsOfType(map, Translate)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/ModifyController.test.ts`
Expected: FAIL — cannot find module `./ModifyController`.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/map/model/ModifyController.ts`:
```ts
import type Map from 'ol/Map';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Collection from 'ol/Collection';
import type Feature from 'ol/Feature';
import { olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

export class ModifyController {
  private map: Map;
  private modify: Modify | null = null;
  private translate: Translate | null = null;

  constructor(map: Map) {
    this.map = map;
  }

  start(feature: Feature, onChange: (geometry: GeoJSONGeometry) => void): void {
    this.cancel();
    const features = new Collection<Feature>([feature]);
    const emit = () => {
      const geom = feature.getGeometry();
      if (geom) onChange(olGeometryTo4326GeoJSON(geom));
    };
    const modify = new Modify({ features });
    modify.on('modifyend', emit);
    const translate = new Translate({ features });
    translate.on('translateend', emit);
    this.map.addInteraction(modify);
    this.map.addInteraction(translate);
    this.modify = modify;
    this.translate = translate;
  }

  cancel(): void {
    if (this.modify) { this.map.removeInteraction(this.modify); this.modify = null; }
    if (this.translate) { this.map.removeInteraction(this.translate); this.translate = null; }
  }

  dispose(): void {
    this.cancel();
  }
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/ModifyController.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/ModifyController.ts apps/web/src/features/map/model/ModifyController.test.ts
git commit -m "feat(web): ModifyController - Modify/Translate on selected feature, emits 4326 GeoJSON"
```

---

### Task 4: Extend the `mapEditing` bridge (edit mode / select / modify / editing)

**Files:**
- Modify: `apps/web/src/features/map/model/mapEditing.tsx`, `apps/web/src/features/map/model/mapEditing.test.tsx`

**Interfaces:**
- Consumes: `SelectController` + `EditSelection` (Task 2), `ModifyController` (Task 3), `LAYER_REGISTRY` (`entities/layer/layerRegistry`), existing `useMapContext`.
- Produces (added to `MapEditingValue`, all non-OL):
  - `editing: boolean`
  - `enterEditMode(onSelected: (sel: EditSelection) => void): void` — activates `SelectController` (scoped to editable layers via `LAYER_REGISTRY`), sets `editing = true`.
  - `exitEditMode(): void` — deactivates select + cancels modify, sets `editing = false`.
  - `startModify(onChange: (g: GeoJSONGeometry) => void): void` — starts `ModifyController` on `SelectController.getSelectedFeature()`.
  - `cancelModify(): void` — cancels modify.
  - `clearSelection(): void` — clears the select controller.
  - Re-export `type EditSelection`.

- [ ] **Step 1: Add the failing delegation tests**

In `apps/web/src/features/map/model/mapEditing.test.tsx`, extend the mocks and add tests. First extend the `./SelectController` and add a `./ModifyController` mock at the top with the existing `./DrawController` mock:
```tsx
const activate = vi.fn(); const deactivate = vi.fn(); const getSelectedFeature = vi.fn(() => ({} as never)); const selClear = vi.fn();
vi.mock('./SelectController', () => ({
  SelectController: vi.fn().mockImplementation(() => ({ activate, deactivate, getSelectedFeature, clear: selClear, dispose: vi.fn() })),
}));
const modStart = vi.fn(); const modCancel = vi.fn();
vi.mock('./ModifyController', () => ({
  ModifyController: vi.fn().mockImplementation(() => ({ start: modStart, cancel: modCancel, dispose: vi.fn() })),
}));
```
Then add a describe block:
```tsx
describe('useMapEditing edit-existing', () => {
  beforeEach(() => { activate.mockReset(); deactivate.mockReset(); modStart.mockReset(); modCancel.mockReset(); });

  it('enterEditMode activates select and sets editing true; exit deactivates', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onSel = vi.fn();
    act(() => result.current.enterEditMode(onSel));
    expect(activate).toHaveBeenCalledWith(onSel);
    expect(result.current.editing).toBe(true);
    act(() => result.current.exitEditMode());
    expect(deactivate).toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it('startModify starts ModifyController on the selected feature', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onChange = vi.fn();
    act(() => result.current.startModify(onChange));
    expect(modStart).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/mapEditing.test.tsx`
Expected: FAIL — `enterEditMode`/`editing`/`startModify` not on the hook value.

- [ ] **Step 3: Extend the bridge**

In `apps/web/src/features/map/model/mapEditing.tsx`:
- Add imports:
```tsx
import { SelectController, type EditSelection } from './SelectController';
import { ModifyController } from './ModifyController';
import { LAYER_REGISTRY } from '../../../entities/layer/layerRegistry';
```
- Re-export the type near the existing `export type { GeoJSONGeometry };`:
```tsx
export type { EditSelection };
```
- Extend `MapEditingValue`:
```tsx
  editing: boolean;
  enterEditMode: (onSelected: (sel: EditSelection) => void) => void;
  exitEditMode: () => void;
  startModify: (onChange: (g: GeoJSONGeometry) => void) => void;
  cancelModify: () => void;
  clearSelection: () => void;
```
- In `MapEditingProvider`, add refs + state and construct the controllers in the same `map` effect:
```tsx
  const selectRef = useRef<SelectController | null>(null);
  const modifyRef = useRef<ModifyController | null>(null);
  const [editing, setEditing] = useState(false);
```
Update the effect so, when `map` becomes available, it also builds the two controllers (guarded like the DrawController):
```tsx
  useEffect(() => {
    if (map && !controllerRef.current) {
      controllerRef.current = new DrawController(map);
      const layerKeyByStateId: Record<string, string> = {};
      for (const e of LAYER_REGISTRY) layerKeyByStateId[e.layerStateId] = e.layerKey;
      selectRef.current = new SelectController(map, layerKeyByStateId as never);
      modifyRef.current = new ModifyController(map);
      setHasMap(true);
    }
    return () => {
      controllerRef.current?.dispose();
      selectRef.current?.dispose();
      modifyRef.current?.dispose();
      controllerRef.current = null;
      selectRef.current = null;
      modifyRef.current = null;
    };
  }, [map]);
```
- Add the callbacks:
```tsx
  const enterEditMode = useCallback((onSelected: (sel: EditSelection) => void) => {
    selectRef.current?.activate(onSelected);
    setEditing(true);
  }, []);
  const exitEditMode = useCallback(() => {
    modifyRef.current?.cancel();
    selectRef.current?.deactivate();
    setEditing(false);
  }, []);
  const startModify = useCallback((onChange: (g: GeoJSONGeometry) => void) => {
    const f = selectRef.current?.getSelectedFeature();
    if (f) modifyRef.current?.start(f, onChange);
  }, []);
  const cancelModify = useCallback(() => { modifyRef.current?.cancel(); }, []);
  const clearSelection = useCallback(() => { selectRef.current?.clear(); }, []);
```
- Add them to the context `value`:
```tsx
    <MapEditingContext.Provider value={{
      hasMap, startDraw, cancelDraw, refreshLayer, registerRefresh,
      editing, enterEditMode, exitEditMode, startModify, cancelModify, clearSelection,
    }}>
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/mapEditing.test.tsx`
Expected: existing (3) + new (2) pass.

- [ ] **Step 5: Build to type-check**

Run: `npm run build:web`
Expected: clean. (The `layerKeyByStateId as never` cast bridges the `string`→`EditableLayerKey` value map; the SelectController's `resolveLayerKey` re-validates, so this is safe. If the reviewer prefers, type `layerKeyByStateId` as `Record<string, EditableLayerKey>` directly by importing the type — either is fine.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/model/mapEditing.tsx apps/web/src/features/map/model/mapEditing.test.tsx
git commit -m "feat(web): extend MapEditing bridge with edit-mode select + modify (non-OL API)"
```

---

### Task 5: Extend `useAttributeFormPresenter` for edit mode

**Files:**
- Modify: `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.ts`, `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.test.ts`

**Interfaces:**
- Consumes: `updateFeature` (Task 1) in addition to `createFeature`; `LAYER_ATTRIBUTE_MAP`, `EditableLayerKey`, `ApiError`, `GeoJSONGeometry`.
- Produces: the same hook, with `Args` extended:
  - `mode?: 'create' | 'edit'` (default `'create'`).
  - `initialValues?: Record<string, string>` — seed values (edit mode).
  - `featureId?: string` — required when `mode === 'edit'`.
  - Behavior: in `edit` mode, `values` initialize from `initialValues` (falling back to `''` per attribute); `canSave = !saving` (geometry optional — an attribute-only PUT is valid); `submit` calls `updateFeature(layerKey, featureId, { geometry: geometry ?? undefined, properties })`. In `create` mode, unchanged (calls `createFeature`, `canSave` requires geometry). The existing `messageFor` 400/422/409 mapping is shared; add **404** → `'This feature no longer exists'`.

- [ ] **Step 1: Add the failing edit-mode tests**

Append to `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.test.ts`:
```ts
import { updateFeature } from '../api/features.api';
// extend the existing vi.mock('../api/features.api', ...) to also expose updateFeature:
//   vi.mock('../api/features.api', () => ({ createFeature: (...a)=>createFeature(...a), updateFeature: (...a)=>updateFeature(...a) }));
// (adjust the existing mock factory accordingly)

describe('useAttributeFormPresenter (edit mode)', () => {
  beforeEach(() => { (updateFeature as ReturnType<typeof vi.fn>).mockReset?.(); });

  it('seeds values from initialValues and can save without geometry', () => {
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name', 'status'], geometry: null,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'Hoa Binh', status: 'binh_thuong' }, onSaved: vi.fn(),
    }));
    expect(result.current.values).toEqual({ name: 'Hoa Binh', status: 'binh_thuong' });
    expect(result.current.canSave).toBe(true); // no geometry required on edit
  });

  it('submit PUTs non-empty props (+ geometry when present) and calls onSaved', async () => {
    (updateFeature as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1' });
    const onSaved = vi.fn();
    const geom = { type: 'Point', coordinates: [108, 13] };
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name'], geometry: geom,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'A' }, onSaved,
    }));
    act(() => result.current.setField('name', 'B'));
    await act(async () => { await result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', { geometry: geom, properties: { name: 'B' } });
    expect(onSaved).toHaveBeenCalled();
  });

  it('maps a 404 to a friendly message', async () => {
    (updateFeature as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name'], geometry: null,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'A' }, onSaved: vi.fn(),
    }));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('This feature no longer exists');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useAttributeFormPresenter.test.ts`
Expected: FAIL — `mode`/`initialValues`/`featureId` not supported; `updateFeature` not called.

- [ ] **Step 3: Extend the presenter**

In `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.ts`:
- Import `updateFeature`: `import { createFeature, updateFeature } from '../api/features.api';`
- Extend `Args`:
```ts
interface Args {
  layerKey: EditableLayerKey;
  attributes: string[];
  geometry: GeoJSONGeometry | null;
  onSaved: () => void;
  mode?: 'create' | 'edit';
  initialValues?: Record<string, string>;
  featureId?: string;
}
```
- Add 404 to `messageFor` (before the final `return`):
```ts
  if (e.status === 404) return { error: 'This feature no longer exists', fieldErrors: {} };
```
- Destructure the new args (with defaults) and seed values:
```ts
export function useAttributeFormPresenter({
  layerKey, attributes, geometry, onSaved,
  mode = 'create', initialValues, featureId,
}: Args) {
```
```ts
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(attributes.map((c) => [c, initialValues?.[c] ?? '']))
  );
```
- `canSave`: create requires geometry; edit does not:
```ts
  const canSave = (mode === 'edit' || geometry !== null) && !saving;
```
- `submit`: branch on mode:
```ts
  const submit = useCallback(async () => {
    if (mode === 'create' && !geometry) { setError('Draw a geometry first'); return; }
    setSaving(true); setError(null); setFieldErrors({});
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '') properties[k] = v;
    try {
      if (mode === 'edit') {
        await updateFeature(layerKey, featureId!, { geometry: geometry ?? undefined, properties });
      } else {
        await createFeature(layerKey, { geometry: geometry!, properties });
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) { const m = messageFor(e); setError(m.error); setFieldErrors(m.fieldErrors); }
      else setError('Something went wrong');
    } finally { setSaving(false); }
  }, [mode, geometry, values, layerKey, featureId, onSaved]);
```
Keep the returned object shape identical.

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useAttributeFormPresenter.test.ts`
Expected: existing create-mode tests + 3 new edit-mode tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin-editing/model/useAttributeFormPresenter.ts apps/web/src/features/admin-editing/model/useAttributeFormPresenter.test.ts
git commit -m "feat(web): attribute-form presenter supports edit mode (prefill + PUT + 404)"
```

---

### Task 6: `useEditExistingPresenter`

**Files:**
- Create: `apps/web/src/features/admin-editing/model/useEditExistingPresenter.ts`, `apps/web/src/features/admin-editing/model/useEditExistingPresenter.test.ts`

**Interfaces:**
- Consumes: `useMapEditing` (Task 4: `enterEditMode`/`exitEditMode`/`startModify`/`cancelModify`/`clearSelection`/`refreshLayer` + `EditSelection`), `deleteFeature` (Task 1), `denormalizeFeatureProperties` + `LAYER_ATTRIBUTE_MAP` + `EditableLayerKey` (`@webatlas/shared`), `GeoJSONGeometry`.
- Produces: `useEditExistingPresenter()` →
  - `editMode: boolean`, `selection: { layerKey: EditableLayerKey; featureId: string; attributes: string[]; initialValues: Record<string,string> } | null`, `workingGeometry: GeoJSONGeometry | null`, `deleting: boolean`, `confirmOpen: boolean`, `error: string | null`.
  - `enter()` / `exit()` — toggle edit mode (calls the bridge). `onSaved()` — refetch + reset (passed to the form). `requestDelete()`/`cancelDelete()`/`confirmDelete()`. On select: builds `attributes` from `LAYER_ATTRIBUTE_MAP[key].attributes` (the DB columns), `initialValues` via `denormalizeFeatureProperties(key, isoProps)` stringified, seeds `workingGeometry` from the selection, and starts modify (updating `workingGeometry` on change).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/admin-editing/model/useEditExistingPresenter.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const enterEditMode = vi.fn(); const exitEditMode = vi.fn(); const startModify = vi.fn();
const cancelModify = vi.fn(); const clearSelection = vi.fn(); const refreshLayer = vi.fn();
vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ enterEditMode, exitEditMode, startModify, cancelModify, clearSelection, refreshLayer,
    hasMap: true, startDraw: vi.fn(), cancelDraw: vi.fn(), registerRefresh: vi.fn(), editing: false }),
}));
const deleteFeature = vi.fn();
vi.mock('../api/features.api', () => ({ deleteFeature: (...a: unknown[]) => deleteFeature(...a), createFeature: vi.fn(), updateFeature: vi.fn() }));
import { useEditExistingPresenter } from './useEditExistingPresenter';

describe('useEditExistingPresenter', () => {
  beforeEach(() => { enterEditMode.mockReset(); exitEditMode.mockReset(); startModify.mockReset(); deleteFeature.mockReset(); refreshLayer.mockReset(); });

  it('enter() activates edit mode', () => {
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    expect(enterEditMode).toHaveBeenCalledWith(expect.any(Function));
    expect(result.current.editMode).toBe(true);
  });

  it('on selection: builds DB-keyed attributes + prefilled values and starts modify', () => {
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    const onSelected = enterEditMode.mock.calls[0][0];
    act(() => onSelected({ layerKey: 'dams', featureId: 'f1',
      geometry: { type: 'Point', coordinates: [108, 13] },
      isoProps: { geographicalName: 'Hoa Binh', operationalStatus: 'Bình thường', layerKey: 'dams' } }));
    expect(result.current.selection?.featureId).toBe('f1');
    expect(result.current.selection?.attributes).toContain('name');   // DB column
    expect(result.current.selection?.initialValues.name).toBe('Hoa Binh');
    expect(result.current.workingGeometry).toEqual({ type: 'Point', coordinates: [108, 13] });
    expect(startModify).toHaveBeenCalledWith(expect.any(Function));
  });

  it('confirmDelete deletes the selected feature, refetches, and resets', async () => {
    deleteFeature.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    const onSelected = enterEditMode.mock.calls[0][0];
    act(() => onSelected({ layerKey: 'dams', featureId: 'f1', geometry: { type: 'Point', coordinates: [108, 13] }, isoProps: {} }));
    act(() => result.current.requestDelete());
    expect(result.current.confirmOpen).toBe(true);
    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteFeature).toHaveBeenCalledWith('dams', 'f1');
    expect(refreshLayer).toHaveBeenCalled();
    expect(result.current.selection).toBeNull();
  });

  it('exit() leaves edit mode and clears selection', () => {
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => result.current.enter());
    act(() => result.current.exit());
    expect(exitEditMode).toHaveBeenCalled();
    expect(result.current.editMode).toBe(false);
    expect(result.current.selection).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useEditExistingPresenter.test.ts`
Expected: FAIL — cannot find module `./useEditExistingPresenter`.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/admin-editing/model/useEditExistingPresenter.ts`:
```ts
import { useState, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, denormalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { useMapEditing, type EditSelection, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { deleteFeature } from '../api/features.api';

interface SelectionVM {
  layerKey: EditableLayerKey;
  featureId: string;
  attributes: string[];
  initialValues: Record<string, string>;
}

export function useEditExistingPresenter() {
  const { enterEditMode, exitEditMode, startModify, cancelModify, clearSelection, refreshLayer } = useMapEditing();
  const [editMode, setEditMode] = useState(false);
  const [selection, setSelection] = useState<SelectionVM | null>(null);
  const [workingGeometry, setWorkingGeometry] = useState<GeoJSONGeometry | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    cancelModify();
    clearSelection();
    setSelection(null);
    setWorkingGeometry(null);
    setConfirmOpen(false);
    setError(null);
  }, [cancelModify, clearSelection]);

  const onSelected = useCallback((sel: EditSelection) => {
    const dbProps = denormalizeFeatureProperties(sel.layerKey, sel.isoProps);
    const attributes = Object.keys(LAYER_ATTRIBUTE_MAP[sel.layerKey].attributes);
    const initialValues: Record<string, string> = {};
    for (const col of attributes) {
      const v = dbProps[col];
      initialValues[col] = v == null ? '' : String(v);
    }
    setSelection({ layerKey: sel.layerKey, featureId: sel.featureId, attributes, initialValues });
    setWorkingGeometry(sel.geometry);
    startModify((g) => setWorkingGeometry(g));
  }, [startModify]);

  const enter = useCallback(() => {
    setEditMode(true);
    enterEditMode(onSelected);
  }, [enterEditMode, onSelected]);

  const exit = useCallback(() => {
    exitEditMode();
    setEditMode(false);
    reset();
  }, [exitEditMode, reset]);

  const onSaved = useCallback(() => {
    if (selection) refreshLayer(LAYER_ATTRIBUTE_MAP[selection.layerKey].layerStateId);
    reset();
  }, [selection, refreshLayer, reset]);

  const requestDelete = useCallback(() => setConfirmOpen(true), []);
  const cancelDelete = useCallback(() => setConfirmOpen(false), []);
  const confirmDelete = useCallback(async () => {
    if (!selection) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFeature(selection.layerKey, selection.featureId);
      refreshLayer(LAYER_ATTRIBUTE_MAP[selection.layerKey].layerStateId);
      reset();
    } catch {
      setError('Could not delete — please try again');
    } finally {
      setDeleting(false);
    }
  }, [selection, refreshLayer, reset]);

  return {
    editMode, selection, workingGeometry, confirmOpen, deleting, error,
    enter, exit, onSaved, requestDelete, cancelDelete, confirmDelete,
  };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useEditExistingPresenter.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin-editing/model/useEditExistingPresenter.ts apps/web/src/features/admin-editing/model/useEditExistingPresenter.test.ts
git commit -m "feat(web): useEditExistingPresenter (select -> prefill/modify -> save/delete)"
```

---

### Task 7: Views — `EditModeToggle` + `ConfirmDialog`

**Files:**
- Create: `apps/web/src/features/admin-editing/ui/EditModeToggle.view.tsx`, `apps/web/src/features/admin-editing/ui/EditModeToggle.view.test.tsx`
- Create: `apps/web/src/shared/ui/ConfirmDialog.tsx`

**Interfaces:** passive views (props only; no `apiClient`/`ol/*`/`features/map/model`).
- `EditModeToggleView({ editMode, onEnter, onExit, hint })` — a button toggling "Edit existing" / "Exit edit"; shows `hint` text while `editMode`.
- `ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, busy })` — dumb dialog over the shared `Modal`; confirm + cancel buttons; `busy` disables confirm.

- [ ] **Step 1: Write the failing EditModeToggle test**

Create `apps/web/src/features/admin-editing/ui/EditModeToggle.view.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditModeToggleView } from './EditModeToggle.view';

describe('EditModeToggleView', () => {
  it('shows "Edit existing" when off and calls onEnter', async () => {
    const onEnter = vi.fn();
    render(<EditModeToggleView editMode={false} onEnter={onEnter} onExit={vi.fn()} hint="" />);
    await userEvent.click(screen.getByRole('button', { name: /edit existing/i }));
    expect(onEnter).toHaveBeenCalled();
  });

  it('shows exit + hint when on and calls onExit', async () => {
    const onExit = vi.fn();
    render(<EditModeToggleView editMode onEnter={vi.fn()} onExit={onExit} hint="Click a feature to edit" />);
    expect(screen.getByText('Click a feature to edit')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /exit edit/i }));
    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/ui/EditModeToggle.view.test.tsx`
Expected: FAIL — cannot find module `./EditModeToggle.view`.

- [ ] **Step 3: Implement the views**

Create `apps/web/src/features/admin-editing/ui/EditModeToggle.view.tsx`:
```tsx
export interface EditModeToggleViewProps {
  editMode: boolean;
  onEnter: () => void;
  onExit: () => void;
  hint: string;
}

// Passive: toggles the edit-existing mode.
export function EditModeToggleView({ editMode, onEnter, onExit, hint }: EditModeToggleViewProps) {
  return (
    <div className="edit-mode-toggle">
      {editMode ? (
        <>
          <button type="button" onClick={onExit}>Exit edit</button>
          {hint && <p className="edit-hint">{hint}</p>}
        </>
      ) : (
        <button type="button" onClick={onEnter}>Edit existing</button>
      )}
    </div>
  );
}
```

Create `apps/web/src/shared/ui/ConfirmDialog.tsx`:
```tsx
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Dumb confirm dialog over the shared Modal.
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel}>
      <div className="confirm-dialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
```
(If `shared/ui/Modal` exports a different name/prop shape, adapt the import to match — verify by reading `apps/web/src/shared/ui/Modal.tsx`; it exposes `Modal({ open, onClose, children })`.)

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/ui/EditModeToggle.view.test.tsx`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin-editing/ui/EditModeToggle.view.tsx apps/web/src/features/admin-editing/ui/EditModeToggle.view.test.tsx apps/web/src/shared/ui/ConfirmDialog.tsx
git commit -m "feat(web): EditModeToggle view + ConfirmDialog (shared/ui)"
```

---

### Task 8: Container wiring + popup suppression + styles + /run

**Files:**
- Modify: `apps/web/src/features/admin-editing/index.tsx`
- Modify: `apps/web/src/components/DynamicPopup.tsx`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `useEditExistingPresenter` (Task 6), `useAttributeFormPresenter` edit mode (Task 5), `EditModeToggleView` (Task 7), `ConfirmDialog` (Task 7), `AttributeFormView`, `useMapEditing().editing` (Task 4).
- Produces: the admin-editing container renders both the existing draw-to-create toolbar and the new edit-existing flow (toggle → on select, a pre-filled `AttributeFormView` with a Delete button → save/delete), all under the same `RequireRole('admin')`. `DynamicPopup` suppresses its singleclick popup while `editing`.

- [ ] **Step 1: Suppress the popup during edit mode**

In `apps/web/src/components/DynamicPopup.tsx`:
- Add the import: `import { useMapEditing } from '../features/map/model/mapEditing';`
- In the component, read editing: `const { editing } = useMapEditing();`
- In the `singleclick` handler (`clickHandler`), early-return when editing so no popup opens:
```tsx
    const clickHandler = (e: any) => {
      if (editing) return; // edit mode owns clicks (feature selection); no popup
      const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f);
      ...
```
- Add `editing` to that `useEffect`'s dependency array (the effect that registers `singleclick`), so the handler re-binds when edit mode toggles. (The effect currently depends on `[map]`; change to `[map, editing]`.)

Note: `DynamicPopup` is a component, so importing the non-OL `useMapEditing` hook is allowed (it does not import `ol/*`). The popup must be rendered inside `MapEditingProvider` — it already is (AppProviders wraps the app).

- [ ] **Step 2: Wire the container**

In `apps/web/src/features/admin-editing/index.tsx`, add imports:
```tsx
import { useEditExistingPresenter } from './model/useEditExistingPresenter';
import { EditModeToggleView } from './ui/EditModeToggle.view';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
```
Add an `EditExisting` component (sibling to `EditToolbar`) and render it inside `AdminEditing` under the same gate. The edit-existing form reuses `useAttributeFormPresenter` in edit mode, fed by the selection:
```tsx
function EditExisting() {
  const edit = useEditExistingPresenter();
  const sel = edit.selection;

  const form = useAttributeFormPresenter({
    layerKey: (sel?.layerKey ?? 'dams') as EditableLayerKey,
    attributes: sel?.attributes ?? [],
    geometry: edit.workingGeometry,
    mode: 'edit',
    featureId: sel?.featureId,
    initialValues: sel?.initialValues,
    onSaved: edit.onSaved,
  });

  return (
    <div className="edit-existing">
      <EditModeToggleView
        editMode={edit.editMode}
        onEnter={edit.enter}
        onExit={edit.exit}
        hint="Click a feature on an editable layer to edit it."
      />
      {sel && (
        <>
          <AttributeFormView
            attributes={sel.attributes}
            labels={form.labels}
            values={form.values}
            fieldErrors={form.fieldErrors}
            error={form.error}
            canSave={form.canSave}
            saving={form.saving}
            onField={form.setField}
            onSubmit={form.submit}
            onCancel={edit.exit}
          />
          <button type="button" className="edit-delete-btn" onClick={edit.requestDelete}>Delete feature</button>
          {edit.error && <p className="edit-form-error" role="alert">{edit.error}</p>}
        </>
      )}
      <ConfirmDialog
        open={edit.confirmOpen}
        title="Delete feature"
        message="Delete this feature? This cannot be undone."
        confirmLabel="Delete"
        busy={edit.deleting}
        onConfirm={edit.confirmDelete}
        onCancel={edit.cancelDelete}
      />
    </div>
  );
}
```
Because `useAttributeFormPresenter` seeds `values` from `initialValues` **once** (in `useState` initializer), the form must remount per selection so a new selection re-seeds. Give it a key tied to the selection:
```tsx
      {sel && (
        <div key={sel.featureId}>
          {/* AttributeFormView + delete button as above */}
        </div>
      )}
```
Wait — the `useAttributeFormPresenter` hook is called at the top of `EditExisting`, so it can't be remounted by an inner key. Instead, extract the selected-feature form into its own child component keyed by `featureId`, so each selection gets a fresh presenter:
```tsx
function EditForm({ sel, workingGeometry, onSaved, onCancel, onDelete }: {
  sel: NonNullable<ReturnType<typeof useEditExistingPresenter>['selection']>;
  workingGeometry: GeoJSONGeometry | null;
  onSaved: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const form = useAttributeFormPresenter({
    layerKey: sel.layerKey, attributes: sel.attributes, geometry: workingGeometry,
    mode: 'edit', featureId: sel.featureId, initialValues: sel.initialValues, onSaved,
  });
  return (
    <>
      <AttributeFormView
        attributes={sel.attributes} labels={form.labels} values={form.values}
        fieldErrors={form.fieldErrors} error={form.error} canSave={form.canSave}
        saving={form.saving} onField={form.setField} onSubmit={form.submit} onCancel={onCancel}
      />
      <button type="button" className="edit-delete-btn" onClick={onDelete}>Delete feature</button>
    </>
  );
}
```
and in `EditExisting` render `{sel && <EditForm key={sel.featureId} sel={sel} workingGeometry={edit.workingGeometry} onSaved={edit.onSaved} onCancel={edit.exit} onDelete={edit.requestDelete} />}`. Import `GeoJSONGeometry` type from `../map/model/mapEditing`. Mount `<EditExisting />` inside `AdminEditing` after `<EditToolbar />`.

- [ ] **Step 3: Write/adjust the container test**

The existing `index.test.tsx` mocks `useMapEditing` and `useLayerCatalog`. Extend the `useMapEditing` mock to include the new methods (`enterEditMode`, `exitEditMode`, `startModify`, `cancelModify`, `clearSelection`, `editing: false`) so the container renders, and add one assertion that the "Edit existing" button shows for an admin:
```tsx
// in the existing admin-rendered test, after render(<AdminEditing />):
expect(screen.getByRole('button', { name: /edit existing/i })).toBeInTheDocument();
```
Update the `vi.mock('../map/model/mapEditing', ...)` factory to include the new methods + `editing: false`.

- [ ] **Step 4: Run the container test**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/index.test.tsx`
Expected: passes (toolbar + the new Edit-existing button render for an admin).

- [ ] **Step 5: Styles**

Append to `apps/web/src/styles/main.css`:
```css
.edit-existing { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.edit-mode-toggle { display: flex; flex-direction: column; gap: 6px; }
.edit-mode-toggle button, .edit-delete-btn, .confirm-actions button { cursor: pointer; padding: 6px 10px; border-radius: 6px; border: none; }
.edit-delete-btn { background: #fee2e2; color: #b91c1c; }
.confirm-dialog { display: flex; flex-direction: column; gap: 10px; min-width: 280px; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-actions button:first-child { background: #ef4444; color: #fff; }
```

- [ ] **Step 6: Build + lint + full web suite**

Run (from repo root):
```bash
npm run build:web
npm run lint:web
npm run test -w @webatlas/web
```
Expected: build clean; lint exit 0 (pre-existing warnings only); all web tests pass. Fix any type error (watch `import type`, unused vars, the `EditForm` prop types).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/admin-editing/index.tsx apps/web/src/features/admin-editing/index.test.tsx apps/web/src/components/DynamicPopup.tsx apps/web/src/styles/main.css
git commit -m "feat(web): wire edit-existing (modify/delete) container + popup suppression + styles"
```

- [ ] **Step 8: Convention guard + manual /run**

- Grep guard (expect zero `ol/*` outside the quarantine):
```bash
git grep -n "from 'ol/" -- 'apps/web/src/features/admin-editing' 'apps/web/src/components/DynamicPopup.tsx' 'apps/web/src/shared/ui' || echo "OK: no ol/* outside quarantine"
```
Expected: `OK: ...`.
- Manual `/run` (stack up: API + GeoServer + web + admin): log in → **Edit existing** → click a dam → the form pre-fills with its current attributes and the marker becomes draggable → move it + change `geographicalName` → **Save** → the dam moves + updates live (WFS refetch). Then select another feature → **Delete feature** → confirm → it disappears. Verify clicking a feature while NOT in edit mode still opens the info popup (suppression only applies in edit mode). Use `@webatlas.test` names; clean up.

---

## Self-Review

**1. Spec coverage (design §1–§9):**
- Explicit edit-mode toggle; selection scoped to editable layers (§1, §3.1) → Tasks 2, 4, 7, 8 ✓
- Modify/move geometry (OL Modify+Translate) (§3.2) → Task 3 ✓
- Edit attributes in a pre-filled form (reuse, not fork) (§3.4) → Task 5 ✓
- Save both via PUT; delete via DELETE + confirm dialog (§4) → Tasks 1, 5, 6, 7, 8 ✓
- Non-OL bridge extension (§3.3) → Task 4 ✓
- Select reconciliation / popup suppression (§3.5) → Task 8 Step 1 ✓
- Geometry+attrs from the loaded WFS feature via denormalize+geo (§4) → Tasks 2, 6 ✓
- Error handling incl. 404 (§5) → Task 5 ✓
- Testing: presenters (mocked bridge/api), views, Select/Modify controllers (OL double), api, /run (§6) → Tasks 1–8 ✓
- Convention rules (§7) → Task 8 grep guard + layering throughout ✓

**2. Placeholder scan:** every step has concrete code/commands; no TBD/TODO. The `'dams'` fallback layerKey in `EditExisting`'s top-level form-args is only referenced when `sel` is null (form not rendered) — the real form lives in the keyed `EditForm` child; if the top-level `useAttributeFormPresenter` call is not needed once `EditForm` is extracted, remove it (Task 8 extracts the form into `EditForm`, so `EditExisting` no longer calls the presenter directly — the implementer should ensure only `EditForm` calls it, avoiding a dead hook call). This is called out in Task 8 Step 2.

**3. Type/name consistency:** `EditSelection` (Task 2 → re-exported Task 4 → consumed Task 6), `updateFeature`/`deleteFeature`/`UpdateFeaturePayload` (Task 1 → Tasks 5, 6), `useMapEditing().{editing,enterEditMode,exitEditMode,startModify,cancelModify,clearSelection}` (Task 4 → Tasks 6, 8), `SelectController.getSelectedFeature` (Task 2 → Task 4), `ModifyController.start(feature,onChange)` (Task 3 → Task 4), `denormalizeFeatureProperties(key, isoProps)` (verified in shared) used Task 6, `EditModeToggleView`/`ConfirmDialog` (Task 7 → Task 8). `mode: 'create'|'edit'` + `initialValues` + `featureId` (Task 5) consumed Task 8. Consistent.

**4. Risks for the implementer:**
- **Form re-seed per selection:** `useAttributeFormPresenter` seeds `values` in `useState` initializer (once). Selecting a different feature must remount the form — Task 8 extracts a keyed `EditForm` child (`key={sel.featureId}`). Do NOT call the presenter at `EditExisting`'s top level and also in `EditForm` (double hook / stale values) — only `EditForm` calls it.
- **OL event type imports** (`SelectEvent`, `modifyend`/`translateend`): `import type` where type-only; the tests dispatch events directly (`dispatchEvent({ type, ... })`) so no pointer simulation is needed in jsdom. ResizeObserver is stubbed per test file (matches the existing `DrawController.test.ts` pattern).
- **`editing` in DynamicPopup:** adding `editing` to the singleclick effect deps re-binds the handler on toggle — verify the cleanup `map.un('singleclick', clickHandler)` still refers to the same handler instance (it does, per-effect-run closure). The popup must be inside `MapEditingProvider` (it is).
- **Select reconciliation:** the rivers-highlight `Select` in `MapModel` still fires on click in edit mode (cosmetic highlight); confirm in `/run` it doesn't interfere with edit selection. If it does, a follow-up can disable it during edit — out of scope unless `/run` shows a problem.
- **StrictMode:** the bridge builds Select/Modify controllers in the guarded `map` effect (idempotent, like DrawController); dispose on cleanup.
- **Lint:** `noUnusedLocals` — if the `'dams'` fallback top-level presenter call is removed, also remove now-unused imports.

---

## Follow-on

- **Editable labels plan** — `app.layer_attribute_labels` + admin GET/PUT + runtime label fetch; the attribute form swaps its label source with no change to the DB-keyed save path (both create + edit).
- **Selection polish** — hover-highlight the hit feature; an "editing this feature" chip; snapping; disable the rivers-highlight Select during edit if `/run` shows interference.
