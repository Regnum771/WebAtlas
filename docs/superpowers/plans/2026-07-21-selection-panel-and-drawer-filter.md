# Selection, Detail Panel & Drawer Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selection a first-class, role-agnostic app concept with an attached detail panel, move the attribute filter into the left drawer for all users, unify filter and search onto one query engine, and constrain the map view to Vietnam.

**Architecture:** A new `entities/selection` slice owns a single map-level OpenLayers `Select` interaction — replacing the two competing ones that exist today — and exposes both click and programmatic (`selectById`) entry. A new `widgets/display-panel` renders the selected feature read-only, attached to the right edge of the existing left drawer, with a round `<<`/`>>` collapse button on the seam. Editing stops owning selection and becomes a subscriber, entered explicitly via a pen on the panel. Filter and search converge on one `runQuery`.

**Tech Stack:** React 19 + TypeScript, OpenLayers (`Select`, `view.fit`), `@webatlas/shared` (rebuilt when its exports change), Vitest + Testing Library, oxlint. No new dependency, no backend/GeoServer change.

**Design doc:** `docs/superpowers/specs/2026-07-21-selection-panel-and-drawer-filter-design.md`

## Global Constraints

- **Branch from `feat/attribute-filter`** (or from `main` once PR #11 has merged) — this plan modifies `features/attribute-filter/*`, which does **not** exist on `main` before that merge. Do **not** branch from `docs/selection-panel-design`.
- **UI copy is Vietnamese**, matching existing components (`Biên tập dữ liệu`, `Xóa lọc`, `Bật lớp để lọc`).
- **Persona gating is UX routing only.** The backend enforces authorization on every write regardless of what the UI shows. Never present a UI gate as a security boundary in comments.
- **The pen is gated on the `steward` persona**, which the `editor` and `admin` roles both inhabit (`entities/persona/persona.ts:21-22`). Never gate on role directly.
- **jsdom discipline:** no assertions about reachability, overlap, visual position, or z-order. Those are verified only in `/run` (Task 9).
- **Commands:** web tests `npm test -w @webatlas/web`; shared tests `npm test -w @webatlas/shared`; shared build `npm run build -w @webatlas/shared`; web build `npm run build -w @webatlas/web`; lint `npm run lint -w @webatlas/web`. `@webatlas/shared` must be rebuilt after any task that changes its exports (Tasks 1 and 8) so the web workspace sees them.
- **Run a single test file** with `npm test -w @webatlas/web -- <path>` and a single case with `-t '<name>'`.
- **Commit after every task.** Each task ends green.

---

### Task 1: Map view constraints — Vietnam extent + one zoom source of truth

Independent of every other task (spec §5). Done first because it is self-contained and de-risks the `/run` pass.

**Files:**
- Create: `packages/shared/src/map-view.ts`
- Create: `packages/shared/src/map-view.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/src/features/map/model/MapModel.ts:115-121`
- Modify: `apps/web/src/components/MapControls.tsx:17-18`

**Interfaces:**
- Produces: `VIETNAM_EXTENT_4326: readonly [number, number, number, number]`, `MAP_MIN_ZOOM: number`, `MAP_MAX_ZOOM: number`, `MAP_DEFAULT_CENTER_4326: readonly [number, number]`, `MAP_DEFAULT_ZOOM: number` from `@webatlas/shared`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/map-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  VIETNAM_EXTENT_4326,
  MAP_MIN_ZOOM,
  MAP_MAX_ZOOM,
  MAP_DEFAULT_CENTER_4326,
  MAP_DEFAULT_ZOOM,
} from './map-view';

describe('map view constants', () => {
  it('spans the whole of Vietnam, not just the south-central coast', () => {
    const [minLon, minLat, maxLon, maxLat] = VIETNAM_EXTENT_4326;
    // Ca Mau (~104.8, 8.6) and Ha Giang (~105.0, 23.3) must both be inside.
    expect(minLon).toBeLessThanOrEqual(104.8);
    expect(minLat).toBeLessThanOrEqual(8.6);
    expect(maxLat).toBeGreaterThanOrEqual(23.3);
    expect(maxLon).toBeGreaterThanOrEqual(109.4);
  });

  it('orders the extent as [minLon, minLat, maxLon, maxLat]', () => {
    const [minLon, minLat, maxLon, maxLat] = VIETNAM_EXTENT_4326;
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
  });

  it('has a zoom floor that keeps the country in view and below the max', () => {
    expect(MAP_MIN_ZOOM).toBeGreaterThan(0);
    expect(MAP_MIN_ZOOM).toBeLessThan(MAP_MAX_ZOOM);
    expect(MAP_DEFAULT_ZOOM).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
    expect(MAP_DEFAULT_ZOOM).toBeLessThanOrEqual(MAP_MAX_ZOOM);
  });

  it('centres inside the extent', () => {
    const [lon, lat] = MAP_DEFAULT_CENTER_4326;
    const [minLon, minLat, maxLon, maxLat] = VIETNAM_EXTENT_4326;
    expect(lon).toBeGreaterThanOrEqual(minLon);
    expect(lon).toBeLessThanOrEqual(maxLon);
    expect(lat).toBeGreaterThanOrEqual(minLat);
    expect(lat).toBeLessThanOrEqual(maxLat);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/shared -- map-view`
Expected: FAIL — `Failed to resolve import "./map-view"`.

- [ ] **Step 3: Implement `map-view.ts`**

Create `packages/shared/src/map-view.ts`:

```ts
/**
 * Map view constraints — the single source of truth for both the OpenLayers View
 * (MapModel) and the zoom buttons (MapControls). These previously disagreed:
 * MapModel used minZoom 4.0 while MapControls defaulted its own state to 6, so the
 * scroll wheel and the buttons enforced different floors.
 */

/**
 * Vietnam's bounding box in EPSG:4326 as [minLon, minLat, maxLon, maxLat].
 * The view extent was previously [107.0, 10.5, 109.5, 16.5] — a south-central
 * coastal strip that excluded the Mekong Delta, Ho Chi Minh City, Hanoi and the
 * entire north, so most of the country could not be panned to.
 */
export const VIETNAM_EXTENT_4326 = [102.1, 8.2, 109.5, 23.4] as const;

/** Zoom floor: the country fits the viewport. Tuned during /run. */
export const MAP_MIN_ZOOM = 5.5;

export const MAP_MAX_ZOOM = 20;

/** Opening view — unchanged from the previous hard-coded values. */
export const MAP_DEFAULT_CENTER_4326 = [108.2, 13.5] as const;
export const MAP_DEFAULT_ZOOM = 7;
```

- [ ] **Step 4: Add the export**

In `packages/shared/src/index.ts`, add alongside the existing exports:

```ts
export * from './map-view';
```

- [ ] **Step 5: Run test to verify it passes + rebuild shared**

Run: `npm test -w @webatlas/shared -- map-view`
Expected: PASS (4 tests).

Run: `npm run build -w @webatlas/shared`
Expected: exit 0. Required before the web workspace can import the new constants.

- [ ] **Step 6: Wire `MapModel` to the constants**

In `apps/web/src/features/map/model/MapModel.ts`, add to the existing `@webatlas/shared` import (or create one if absent):

```ts
import {
  VIETNAM_EXTENT_4326,
  MAP_MIN_ZOOM,
  MAP_MAX_ZOOM,
  MAP_DEFAULT_CENTER_4326,
  MAP_DEFAULT_ZOOM,
} from '@webatlas/shared';
```

Replace the `view: new View({...})` block at lines 115-121 with:

```ts
      view: new View({
        center: fromLonLat([...MAP_DEFAULT_CENTER_4326]),
        zoom: MAP_DEFAULT_ZOOM,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        extent: transformExtent([...VIETNAM_EXTENT_4326], 'EPSG:4326', 'EPSG:3857'),
      }),
```

The spread copies the `as const` readonly tuples into the mutable arrays `fromLonLat`/`transformExtent` expect.

- [ ] **Step 7: Wire `MapControls` to the constants**

In `apps/web/src/components/MapControls.tsx`, add the import:

```ts
import { MAP_MIN_ZOOM, MAP_MAX_ZOOM } from '@webatlas/shared';
```

Replace lines 17-18:

```ts
  const [minZoom, setMinZoom] = useState<number>(MAP_MIN_ZOOM);
  const [maxZoom, setMaxZoom] = useState<number>(MAP_MAX_ZOOM);
```

Leave the rest of the component (including whatever later syncs these from the live view) untouched.

- [ ] **Step 8: Also update the home button target**

In `apps/web/src/components/MapControls.tsx:120`, the home button hard-codes the same centre and zoom. Replace it so it cannot drift from the View:

```ts
  const handleHome = () => map?.getView().animate({
    center: fromLonLat([...MAP_DEFAULT_CENTER_4326]),
    zoom: MAP_DEFAULT_ZOOM,
    duration: 500,
  });
```

Add `MAP_DEFAULT_CENTER_4326, MAP_DEFAULT_ZOOM` to the `@webatlas/shared` import from Step 7.

- [ ] **Step 9: Run the full web suite**

Run: `npm test -w @webatlas/web`
Expected: PASS, no regressions.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/map-view.ts packages/shared/src/map-view.test.ts packages/shared/src/index.ts packages/shared/dist apps/web/src/features/map/model/MapModel.ts apps/web/src/components/MapControls.tsx
git commit -m "fix(map): constrain the view to Vietnam; one source of truth for zoom"
```

---

### Task 2: Selection entity — types and the pure id helper

Builds the testable core of `entities/selection` before touching any OpenLayers wiring.

**Files:**
- Create: `apps/web/src/entities/selection/model/selection.ts`
- Create: `apps/web/src/entities/selection/model/selection.test.ts`

**Interfaces:**
- Produces: `Selection` interface; `parseFeatureId(rawId: string): { typename: string; featureId: string }`; `resolveLayerKey(typename: string, layerKeyByStateId: Record<string, EditableLayerKey>): EditableLayerKey | null`.
- Consumed by: Tasks 3, 4, 6, 7.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/entities/selection/model/selection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFeatureId, resolveLayerKey } from './selection';

describe('parseFeatureId', () => {
  it('splits a WFS id into typename and bare id', () => {
    expect(parseFeatureId('dams.a1b2c3')).toEqual({ typename: 'dams', featureId: 'a1b2c3' });
  });

  it('keeps a uuid containing dots intact after the first dot', () => {
    expect(parseFeatureId('rivers.a.b.c')).toEqual({ typename: 'rivers', featureId: 'a.b.c' });
  });

  it('treats an id with no dot as a bare id with no typename', () => {
    expect(parseFeatureId('plain-id')).toEqual({ typename: '', featureId: 'plain-id' });
  });

  it('handles an empty id without throwing', () => {
    expect(parseFeatureId('')).toEqual({ typename: '', featureId: '' });
  });
});

describe('resolveLayerKey', () => {
  const map = { 'dams-layer': 'dams', 'rivers-layer': 'rivers' } as const;

  it('resolves a known typename to its layer key', () => {
    expect(resolveLayerKey('dams', { ...map })).toBe('dams');
  });

  it('returns null for a typename that is not an editable layer', () => {
    expect(resolveLayerKey('provinces', { ...map })).toBeNull();
    expect(resolveLayerKey('', { ...map })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- entities/selection`
Expected: FAIL — cannot resolve `./selection`.

- [ ] **Step 3: Implement `selection.ts`**

Create `apps/web/src/entities/selection/model/selection.ts`:

```ts
import type { EditableLayerKey } from '@webatlas/shared';
import type Feature from 'ol/Feature';

/**
 * What is currently selected on the map. Role-agnostic and mode-free: any user can
 * select any feature at any time, by clicking the map or from a result list.
 *
 * This deliberately carries the LIVE OpenLayers feature rather than a serialised
 * copy — editing derives its GeoJSON/denormalised shape from it on demand (Task 7),
 * so read-only consumers never pay for that conversion.
 */
export interface Selection {
  layerKey: EditableLayerKey;
  featureId: string;
  feature: Feature;
  isoProps: Record<string, unknown>;
}

/**
 * WFS feature ids arrive as "<typename>.<uuid>" (e.g. "dams.a1b2c3"). Split on the
 * FIRST dot only — the id portion may itself contain dots.
 */
export function parseFeatureId(rawId: string): { typename: string; featureId: string } {
  const dot = rawId.indexOf('.');
  if (dot < 0) return { typename: '', featureId: rawId };
  return { typename: rawId.slice(0, dot), featureId: rawId.slice(dot + 1) };
}

/** Map a WFS typename to its editable layer key, or null if it is not a thematic layer. */
export function resolveLayerKey(
  typename: string,
  layerKeyByStateId: Record<string, EditableLayerKey>,
): EditableLayerKey | null {
  if (typename === '') return null;
  const values = Object.values(layerKeyByStateId) as string[];
  return values.includes(typename) ? (typename as EditableLayerKey) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- entities/selection`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/entities/selection/
git commit -m "feat(web): selection entity types + id helpers"
```

---

### Task 3: SelectionController — one interaction, click + programmatic

Replaces both existing `Select` interactions. Modelled on the current `SelectController` (which it supersedes) so the codebase keeps one controller idiom.

**Files:**
- Create: `apps/web/src/entities/selection/model/SelectionController.ts`
- Create: `apps/web/src/entities/selection/model/SelectionController.test.ts`

**Interfaces:**
- Consumes: `Selection`, `parseFeatureId`, `resolveLayerKey` (Task 2).
- Produces: `class SelectionController` with `constructor(map, layerKeyByStateId)`, `activate(onChange: (sel: Selection | null) => void): void`, `selectById(layerKey, featureId): Selection | null`, `getSelected(): Selection | null`, `clear(): void`, `deactivate(): void`, `dispose(): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/entities/selection/model/SelectionController.test.ts`. It uses hand-built fakes — no real OpenLayers map — mirroring how `SelectController.test.ts` already tests this layer:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SelectionController } from './SelectionController';

function makeFeature(id: string, props: Record<string, unknown> = {}) {
  return {
    getId: () => id,
    getGeometryName: () => 'geometry',
    getProperties: () => ({ geometry: { fake: true }, ...props }),
  };
}

function makeMap(featuresByStateId: Record<string, ReturnType<typeof makeFeature>[]>) {
  const interactions: unknown[] = [];
  const layers = Object.entries(featuresByStateId).map(([stateId, feats]) => ({
    get: (k: string) => (k === 'id' ? stateId : undefined),
    getSource: () => ({ getFeatures: () => feats }),
  }));
  return {
    interactions,
    addInteraction: (i: unknown) => interactions.push(i),
    removeInteraction: (i: unknown) => {
      const idx = interactions.indexOf(i);
      if (idx >= 0) interactions.splice(idx, 1);
    },
    getLayers: () => ({ getArray: () => layers }),
  };
}

const KEYS = { 'dams-layer': 'dams', 'rivers-layer': 'rivers' } as const;

describe('SelectionController', () => {
  it('selects a feature by id and reports it via the change callback', () => {
    const dam = makeFeature('dams.a1', { geographicalName: 'Hoa Binh' });
    const map = makeMap({ 'dams-layer': [dam] });
    const onChange = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(onChange);

    const sel = c.selectById('dams', 'a1');

    expect(sel?.featureId).toBe('a1');
    expect(sel?.layerKey).toBe('dams');
    expect(sel?.isoProps.geographicalName).toBe('Hoa Binh');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ featureId: 'a1' }));
    expect(c.getSelected()?.featureId).toBe('a1');
  });

  it('omits the geometry property from isoProps', () => {
    const dam = makeFeature('dams.a1', { geographicalName: 'Hoa Binh' });
    const map = makeMap({ 'dams-layer': [dam] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(vi.fn());

    const sel = c.selectById('dams', 'a1');

    expect(sel?.isoProps).not.toHaveProperty('geometry');
  });

  it('returns null when the feature id is not present in the layer', () => {
    const map = makeMap({ 'dams-layer': [makeFeature('dams.a1')] });
    const onChange = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(onChange);

    expect(c.selectById('dams', 'nope')).toBeNull();
    expect(c.getSelected()).toBeNull();
  });

  it('clear() drops the selection and notifies with null', () => {
    const map = makeMap({ 'dams-layer': [makeFeature('dams.a1')] });
    const onChange = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(onChange);
    c.selectById('dams', 'a1');
    onChange.mockClear();

    c.clear();

    expect(c.getSelected()).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('adds exactly one interaction on activate and removes it on deactivate', () => {
    const map = makeMap({ 'dams-layer': [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });

    c.activate(vi.fn());
    expect(map.interactions).toHaveLength(1);

    c.deactivate();
    expect(map.interactions).toHaveLength(0);
  });

  it('activate() twice does not stack interactions', () => {
    const map = makeMap({ 'dams-layer': [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });

    c.activate(vi.fn());
    c.activate(vi.fn());

    expect(map.interactions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- SelectionController`
Expected: FAIL — cannot resolve `./SelectionController`.

- [ ] **Step 3: Implement `SelectionController.ts`**

Create `apps/web/src/entities/selection/model/SelectionController.ts`:

```ts
import type Map from 'ol/Map';
import Select from 'ol/interaction/Select';
import type { SelectEvent } from 'ol/interaction/Select';
import type Feature from 'ol/Feature';
import type BaseLayer from 'ol/layer/Base';
import type { EditableLayerKey } from '@webatlas/shared';
import { parseFeatureId, resolveLayerKey, type Selection } from './selection';
import { makeSelectionStyle } from './selectionStyle';

/**
 * The app's ONE selection interaction. It replaces two that previously coexisted and
 * did not know about each other: a rivers-only Select in MapModel (always active) and
 * the editing-only SelectController (active only inside edit mode).
 *
 * Selection is role-agnostic and mode-free. Editing subscribes to it; it does not own
 * it, and selecting never starts geometry modification.
 */
export class SelectionController {
  private map: Map;
  private layerKeyByStateId: Record<string, EditableLayerKey>;
  private select: Select | null = null;
  private selected: Selection | null = null;
  private onChange: ((sel: Selection | null) => void) | null = null;

  constructor(map: Map, layerKeyByStateId: Record<string, EditableLayerKey>) {
    this.map = map;
    this.layerKeyByStateId = layerKeyByStateId;
  }

  activate(onChange: (sel: Selection | null) => void): void {
    this.deactivate();
    this.onChange = onChange;
    const editableIds = new Set(Object.keys(this.layerKeyByStateId));
    const select = new Select({
      layers: (layer: BaseLayer) => editableIds.has(layer.get('id')),
      style: makeSelectionStyle,
    });
    select.on('select', (evt: SelectEvent) => {
      const feature = evt.selected[0];
      if (!feature) { this.setSelected(null); return; }
      this.setSelected(this.toSelection(feature));
    });
    this.map.addInteraction(select);
    this.select = select;
  }

  /**
   * Select a feature the user did not click — e.g. from a filter or search result.
   * Returns the resulting Selection, or null if the feature is not loaded.
   */
  selectById(layerKey: EditableLayerKey, featureId: string): Selection | null {
    const feature = this.findFeature(layerKey, featureId);
    if (!feature) return null;
    const sel = this.toSelection(feature);
    if (!sel) return null;
    // Keep the OL interaction's own collection in step so the highlight renders and a
    // subsequent map click deselects cleanly.
    const coll = this.select?.getFeatures();
    coll?.clear();
    coll?.push(feature);
    this.setSelected(sel);
    return sel;
  }

  getSelected(): Selection | null {
    return this.selected;
  }

  clear(): void {
    this.select?.getFeatures().clear();
    this.setSelected(null);
  }

  deactivate(): void {
    this.select?.getFeatures().clear();
    this.selected = null;
    if (this.select) {
      this.map.removeInteraction(this.select);
      this.select = null;
    }
    this.onChange = null;
  }

  dispose(): void {
    this.deactivate();
  }

  private setSelected(sel: Selection | null): void {
    this.selected = sel;
    this.onChange?.(sel);
  }

  private findFeature(layerKey: EditableLayerKey, featureId: string): Feature | null {
    const stateId = Object.keys(this.layerKeyByStateId)
      .find((id) => this.layerKeyByStateId[id] === layerKey);
    if (!stateId) return null;
    const layer = this.map.getLayers().getArray()
      .find((l) => l.get('id') === stateId) as
      | { getSource(): { getFeatures(): Feature[] } | null }
      | undefined;
    const src = layer?.getSource?.();
    if (!src) return null;
    return src.getFeatures()
      .find((f) => parseFeatureId(String(f.getId() ?? '')).featureId === featureId) ?? null;
  }

  private toSelection(feature: Feature): Selection | null {
    const { typename, featureId } = parseFeatureId(String(feature.getId() ?? ''));
    const layerKey = resolveLayerKey(typename, this.layerKeyByStateId);
    if (!layerKey) return null;
    const geomKey = feature.getGeometryName();
    const isoProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(feature.getProperties())) {
      if (k !== geomKey) isoProps[k] = v;
    }
    return { layerKey, featureId, feature, isoProps };
  }
}
```

- [ ] **Step 4: Implement `selectionStyle.ts`**

The rivers highlight must not regress — `MapModel` currently applies `makeRiverSelectStyle()` to its rivers-only Select, which Task 6 removes. Create `apps/web/src/entities/selection/model/selectionStyle.ts`:

```ts
import type FeatureLike from 'ol/Feature';
import { makeRiverSelectStyle } from '../../../features/map/model/styles';

/**
 * Highlight style for the single selection interaction. Rivers keep the exact look
 * they had under MapModel's rivers-only Select (which this replaces); everything else
 * gets the same treatment so one visual language means "this is selected".
 */
export function makeSelectionStyle(feature: FeatureLike) {
  return makeRiverSelectStyle(feature);
}
```

Before writing this, open `apps/web/src/features/map/model/styles.ts` and check `makeRiverSelectStyle`'s real signature. If it takes no argument, drop the parameter and return `makeRiverSelectStyle()`. If it is not exported, export it. Adjust the call to match — do not guess.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- SelectionController`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/entities/selection/
git commit -m "feat(web): SelectionController — one interaction, click + selectById"
```

---

### Task 4: Selection provider

React access to the controller, so views and presenters share one selection.

**Files:**
- Create: `apps/web/src/entities/selection/index.ts`
- Create: `apps/web/src/entities/selection/model/SelectionProvider.tsx`
- Create: `apps/web/src/entities/selection/model/SelectionProvider.test.tsx`
- Modify: `apps/web/src/app/providers/AppProviders.tsx`

**Interfaces:**
- Consumes: `SelectionController` (Task 3), `useMapContext` from `app/providers/MapProvider`, `LAYER_REGISTRY` from `entities/layer/layerRegistry`.
- Produces: `<SelectionProvider>`; `useSelection(): { selection: Selection | null; selectById(layerKey, featureId): Selection | null; clear(): void }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/entities/selection/model/SelectionProvider.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SelectionProvider } from './SelectionProvider';
import { useSelection } from './useSelection';

const selectByIdMock = vi.fn();
const clearMock = vi.fn();
let capturedOnChange: ((sel: unknown) => void) | null = null;

vi.mock('./SelectionController', () => ({
  SelectionController: class {
    activate(onChange: (sel: unknown) => void) { capturedOnChange = onChange; }
    selectById(...args: unknown[]) { return selectByIdMock(...args); }
    clear() { clearMock(); }
    dispose() {}
  },
}));

vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: { fake: 'map' } }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SelectionProvider>{children}</SelectionProvider>
);

describe('SelectionProvider', () => {
  it('starts with no selection', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });
    expect(result.current.selection).toBeNull();
  });

  it('exposes the selection the controller reports', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    act(() => { capturedOnChange?.({ layerKey: 'dams', featureId: 'a1' }); });

    expect(result.current.selection).toEqual({ layerKey: 'dams', featureId: 'a1' });
  });

  it('delegates selectById and clear to the controller', () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    act(() => { result.current.selectById('dams', 'a1'); });
    act(() => { result.current.clear(); });

    expect(selectByIdMock).toHaveBeenCalledWith('dams', 'a1');
    expect(clearMock).toHaveBeenCalled();
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useSelection())).toThrow(/SelectionProvider/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- SelectionProvider`
Expected: FAIL — cannot resolve `./SelectionProvider`.

- [ ] **Step 3: Implement `useSelection.ts`**

Create `apps/web/src/entities/selection/model/useSelection.ts`:

```ts
import { createContext, useContext } from 'react';
import type { EditableLayerKey } from '@webatlas/shared';
import type { Selection } from './selection';

export interface SelectionValue {
  selection: Selection | null;
  selectById: (layerKey: EditableLayerKey, featureId: string) => Selection | null;
  clear: () => void;
}

export const SelectionContext = createContext<SelectionValue | undefined>(undefined);

export function useSelection(): SelectionValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within a SelectionProvider');
  return ctx;
}
```

- [ ] **Step 4: Implement `SelectionProvider.tsx`**

Create `apps/web/src/entities/selection/model/SelectionProvider.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditableLayerKey } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { LAYER_REGISTRY } from '../../layer/layerRegistry';
import { SelectionController } from './SelectionController';
import { SelectionContext } from './useSelection';
import type { Selection } from './selection';

export function SelectionProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext();
  const controllerRef = useRef<SelectionController | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!map) return;
    const layerKeyByStateId: Record<string, EditableLayerKey> = {};
    for (const e of LAYER_REGISTRY) layerKeyByStateId[e.layerStateId] = e.layerKey;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, layerKeyByStateId);
    c.activate(setSelection);
    controllerRef.current = c;
    return () => {
      c.dispose();
      controllerRef.current = null;
      setSelection(null);
    };
  }, [map]);

  const selectById = useCallback(
    (layerKey: EditableLayerKey, featureId: string) =>
      controllerRef.current?.selectById(layerKey, featureId) ?? null,
    [],
  );
  const clear = useCallback(() => controllerRef.current?.clear(), []);

  return (
    <SelectionContext.Provider value={{ selection, selectById, clear }}>
      {children}
    </SelectionContext.Provider>
  );
}
```

- [ ] **Step 5: Add the slice barrel**

Create `apps/web/src/entities/selection/index.ts`:

```ts
export { SelectionProvider } from './model/SelectionProvider';
export { useSelection } from './model/useSelection';
export type { Selection } from './model/selection';
```

- [ ] **Step 6: Mount the provider**

Open `apps/web/src/app/providers/AppProviders.tsx`. Add the import and wrap the existing children so `SelectionProvider` sits **inside** the map provider (it calls `useMapContext`) and **outside** anything that consumes selection:

```tsx
import { SelectionProvider } from '../../entities/selection';
```

Place `<SelectionProvider>` immediately inside the map provider element, wrapping whatever that element currently wraps. Read the file first and match its existing nesting — do not restructure unrelated providers.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- SelectionProvider`
Expected: PASS (4 tests).

Run: `npm test -w @webatlas/web`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/entities/selection/ apps/web/src/app/providers/AppProviders.tsx
git commit -m "feat(web): SelectionProvider + useSelection"
```

---

### Task 5: Unified query engine — `runQuery`

Collapses `searchAllLayers` and the filter's feature-reading into one function, and fixes `eq`/empty-conditions semantics.

**Files:**
- Modify: `apps/web/src/features/attribute-filter/model/applyFilter.ts`
- Modify: `apps/web/src/features/attribute-filter/model/applyFilter.test.ts`
- Create: `apps/web/src/features/attribute-filter/model/runQuery.ts`
- Create: `apps/web/src/features/attribute-filter/model/runQuery.test.ts`

**Interfaces:**
- Consumes: `LAYER_LABELS` from `./layerLabels`; `EDITABLE_LAYER_KEYS`, `LAYER_ATTRIBUTE_MAP` from `@webatlas/shared`.
- Produces: `Operator` gains `'contains'`; `Query { layers: EditableLayerKey[] | 'all'; conditions: Condition[] }`; `QueryHit { layerKey; layerLabel; featureId; label; feature }`; `LayerQueryResult { hits: QueryHit[]; total: number; unloadedLayers: EditableLayerKey[] }`; `runQuery(map, query, cap?): LayerQueryResult`.

- [ ] **Step 1: Write the failing tests for the `applyFilter` changes**

In `apps/web/src/features/attribute-filter/model/applyFilter.test.ts`, add these cases to the existing describe block (keep every existing test):

```ts
  it('eq is exact, not substring — xa_lu must not match xa_lu_khan_cap', () => {
    const feats = [
      { getProperties: () => ({ statusSlug: 'xa_lu_khan_cap' }), getGeometry: () => null },
      { getProperties: () => ({ statusSlug: 'xa_lu' }), getGeometry: () => null },
    ];
    const out = applyFilter(feats, [{ field: 'statusSlug', op: 'eq', value: 'xa_lu' }]);
    expect(out).toHaveLength(1);
    expect(out[0].getProperties().statusSlug).toBe('xa_lu');
  });

  it('eq ignores case and surrounding whitespace', () => {
    const feats = [{ getProperties: () => ({ riskLevel: ' Cao ' }), getGeometry: () => null }];
    expect(applyFilter(feats, [{ field: 'riskLevel', op: 'eq', value: 'cao' }])).toHaveLength(1);
  });

  it('contains is a case-insensitive substring match', () => {
    const feats = [{ getProperties: () => ({ geographicalName: 'Sông Ba' }), getGeometry: () => null }];
    expect(applyFilter(feats, [{ field: 'geographicalName', op: 'contains', value: 'ba' }])).toHaveLength(1);
    expect(applyFilter(feats, [{ field: 'geographicalName', op: 'contains', value: 'xyz' }])).toHaveLength(0);
  });

  it('returns ALL features when there are no conditions (display capping is the caller job)', () => {
    const feats = [
      { getProperties: () => ({ a: 1 }), getGeometry: () => null },
      { getProperties: () => ({ a: 2 }), getGeometry: () => null },
    ];
    expect(applyFilter(feats, [])).toHaveLength(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @webatlas/web -- applyFilter`
Expected: FAIL — the exact-`eq` case returns 2, and the empty-conditions case returns 0.

- [ ] **Step 3: Update `applyFilter.ts`**

Replace the whole file with:

```ts
export type Operator = 'eq' | 'contains' | 'gte' | 'lte' | 'between';

export interface Condition {
  field: string;      // ISO property name on the feature
  op: Operator;
  value: unknown;
  value2?: unknown;   // upper bound for 'between'
  scale?: number;     // divide the feature's raw value by this before comparing (e.g. metres -> km with 1000)
}

// Minimal shape so tests need no OpenLayers. Real ol/Feature satisfies this.
export interface FeatureLike {
  getProperties(): Record<string, unknown>;
  getGeometry(): unknown;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function norm(v: unknown): string {
  return String(v).trim().toLowerCase();
}

function matchesCondition(props: Record<string, unknown>, c: Condition): boolean {
  const raw = props[c.field];
  if (raw === undefined || raw === null) return false;

  // 'eq' is EXACT (normalised). It used to be a substring test, which meant an enum
  // value like 'xa_lu' also matched 'xa_lu_khan_cap'. Text fields that want substring
  // semantics ask for 'contains' explicitly.
  if (c.op === 'eq') return norm(raw) === norm(c.value);
  if (c.op === 'contains') return norm(raw).includes(norm(c.value));

  const rawN = toNumber(raw);
  const a = toNumber(c.value);
  if (rawN === null || a === null) return false;
  // Compare in the user's units: divide the feature's raw value by the field scale (default 1).
  const n = rawN / (c.scale && c.scale !== 0 ? c.scale : 1);
  if (c.op === 'gte') return n >= a;
  if (c.op === 'lte') return n <= a;
  if (c.op === 'between') {
    const b = toNumber(c.value2);
    if (b === null) return false;
    return n >= a && n <= b;
  }
  return false;
}

/**
 * AND semantics: a feature matches iff it satisfies EVERY condition.
 * No conditions means no predicate, so everything matches — deciding not to RENDER an
 * unfiltered list is a display concern and lives in the presenter.
 */
export function applyFilter(features: FeatureLike[], conditions: Condition[]): FeatureLike[] {
  if (conditions.length === 0) return [...features];
  return features.filter((f) => {
    const props = f.getProperties();
    return conditions.every((c) => matchesCondition(props, c));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- applyFilter`
Expected: PASS. If a pre-existing test asserted `applyFilter(feats, [])` returns `[]`, update that test to expect all features — the semantics changed deliberately.

- [ ] **Step 5: Write the failing test for `runQuery`**

Create `apps/web/src/features/attribute-filter/model/runQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runQuery } from './runQuery';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

function feat(id: string, props: Record<string, unknown>) {
  return { getId: () => id, getProperties: () => props, getGeometry: () => ({ fake: true }) };
}

// Build a fake map exposing only what runQuery reads.
function makeMap(byLayerKey: Record<string, ReturnType<typeof feat>[] | null>) {
  const layers = Object.entries(byLayerKey).map(([layerKey, feats]) => ({
    get: (k: string) => (k === 'id' ? LAYER_ATTRIBUTE_MAP[layerKey as 'dams'].layerStateId : undefined),
    getSource: () => (feats === null ? null : { getFeatures: () => feats }),
  }));
  return { getLayers: () => ({ getArray: () => layers }) };
}

describe('runQuery', () => {
  it('searches one name condition across all layers and tags each hit', () => {
    const map = makeMap({
      dams: [feat('dams.d1', { geographicalName: 'Thuy dien Song Ba' })],
      rivers: [feat('rivers.r1', { geographicalName: 'Song Ba' })],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: 'all',
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'song ba' }],
    });

    expect(out.hits).toHaveLength(2);
    expect(out.hits.map((h) => h.layerKey).sort()).toEqual(['dams', 'rivers']);
    expect(out.hits.find((h) => h.layerKey === 'rivers')?.layerLabel).toBe('Mạng lưới sông ngòi');
  });

  it('scopes to the named layer and ANDs multiple conditions', () => {
    const map = makeMap({
      dams: [
        feat('dams.d1', { geographicalName: 'A', statusSlug: 'xa_lu', ratedPower: 300 }),
        feat('dams.d2', { geographicalName: 'B', statusSlug: 'xa_lu', ratedPower: 100 }),
        feat('dams.d3', { geographicalName: 'C', statusSlug: 'binh_thuong', ratedPower: 900 }),
      ],
      rivers: [feat('rivers.r1', { geographicalName: 'Song Ba' })],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [
        { field: 'statusSlug', op: 'eq', value: 'xa_lu' },
        { field: 'ratedPower', op: 'gte', value: 200 },
      ],
    });

    expect(out.hits).toHaveLength(1);
    expect(out.hits[0].featureId).toBe('d1');
  });

  it('carries the real feature id so a rebuilt array cannot mis-resolve a hit', () => {
    const map = makeMap({ dams: [feat('dams.abc', { geographicalName: 'A' })] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'a' }],
    });
    expect(out.hits[0].featureId).toBe('abc');
  });

  it('reports layers with no loaded source as unloaded rather than silently omitting them', () => {
    const map = makeMap({
      dams: [feat('dams.d1', { geographicalName: 'A' })],
      rivers: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams', 'rivers'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'a' }],
    });

    expect(out.unloadedLayers).toContain('rivers');
    expect(out.hits).toHaveLength(1);
  });

  it('caps the hits but reports the true total', () => {
    const many = Array.from({ length: 30 }, (_, i) => feat(`dams.d${i}`, { geographicalName: `Dam ${i}` }));
    const map = makeMap({ dams: many });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'dam' }],
    }, 20);

    expect(out.hits).toHaveLength(20);
    expect(out.total).toBe(30);
  });

  it('returns nothing for an empty query with no conditions', () => {
    const map = makeMap({ dams: [feat('dams.d1', { geographicalName: 'A' })] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, { layers: 'all', conditions: [] });
    expect(out.hits).toHaveLength(0);
    expect(out.total).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- runQuery`
Expected: FAIL — cannot resolve `./runQuery`.

- [ ] **Step 7: Implement `runQuery.ts`**

Create `apps/web/src/features/attribute-filter/model/runQuery.ts`:

```ts
import type { Map as OlMap } from 'ol';
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { applyFilter, type Condition, type FeatureLike } from './applyFilter';
import { LAYER_LABELS } from './layerLabels';
import { parseFeatureId } from '../../../entities/selection/model/selection';

export const DEFAULT_RESULT_CAP = 20;

export interface Query {
  /** 'all' searches every thematic layer; an array scopes to those layers. */
  layers: EditableLayerKey[] | 'all';
  conditions: Condition[];
}

export interface QueryHit {
  layerKey: EditableLayerKey;
  layerLabel: string;
  /** The feature's real identity, NOT its index — an index cannot survive a source reload. */
  featureId: string;
  label: string;
  feature: FeatureLike;
}

export interface LayerQueryResult {
  hits: QueryHit[];
  /** Total matches before the display cap, so the UI can show "20 / N". */
  total: number;
  /** Queried layers with nothing loaded — surfaced so empty != "does not exist". */
  unloadedLayers: EditableLayerKey[];
}

interface IdFeature extends FeatureLike {
  getId?(): string | number | undefined;
}

function readFeatures(map: OlMap, layerKey: EditableLayerKey): IdFeature[] | null {
  const stateId = LAYER_ATTRIBUTE_MAP[layerKey].layerStateId;
  const layer = map.getLayers().getArray()
    .find((l: { get(k: string): unknown }) => l.get('id') === stateId) as
    | { getSource(): { getFeatures(): IdFeature[] } | null }
    | undefined;
  const src = layer?.getSource?.();
  if (!src) return null;
  return src.getFeatures();
}

/**
 * The one query path behind BOTH surfaces: the drawer filter (one layer, N conditions)
 * and the top-bar search (all layers, one name condition). Runs over features already
 * loaded in the browser, so results reflect what the map has — layers that contributed
 * nothing because they are not loaded come back in `unloadedLayers` rather than being
 * silently dropped.
 */
export function runQuery(
  map: OlMap | null,
  query: Query,
  cap: number = DEFAULT_RESULT_CAP,
): LayerQueryResult {
  const empty: LayerQueryResult = { hits: [], total: 0, unloadedLayers: [] };
  if (!map || query.conditions.length === 0) return empty;

  const keys = query.layers === 'all' ? [...EDITABLE_LAYER_KEYS] : query.layers;
  const hits: QueryHit[] = [];
  const unloadedLayers: EditableLayerKey[] = [];
  let total = 0;

  for (const layerKey of keys) {
    const features = readFeatures(map, layerKey);
    if (features === null || features.length === 0) {
      unloadedLayers.push(layerKey);
      continue;
    }
    const matched = applyFilter(features, query.conditions) as IdFeature[];
    total += matched.length;
    for (const f of matched) {
      if (hits.length >= cap) continue;
      const props = f.getProperties();
      const { featureId } = parseFeatureId(String(f.getId?.() ?? ''));
      hits.push({
        layerKey,
        layerLabel: LAYER_LABELS[layerKey],
        featureId,
        label: String(props.geographicalName ?? props.localId ?? featureId),
        feature: f,
      });
    }
  }

  return { hits, total, unloadedLayers };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- runQuery applyFilter`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/attribute-filter/model/
git commit -m "feat(web): unified runQuery; eq is exact, contains added"
```

---

### Task 6: Retire the two old Select interactions

Removes the rivers-only Select from `MapModel` and points editing at the shared selection. No user-visible change: the existing editing tests are the proof.

**Files:**
- Modify: `apps/web/src/features/map/model/MapModel.ts:125-131`
- Modify: `apps/web/src/features/map/model/mapEditing.tsx`
- Delete: `apps/web/src/features/map/model/SelectController.ts`
- Delete: `apps/web/src/features/map/model/SelectController.test.ts`

**Interfaces:**
- Consumes: `SelectionController` (Task 3), `useSelection` (Task 4).
- Produces: `useMapEditing()` keeps `startModify`, `cancelModify`, `refreshLayer`, `registerRefresh`, `registerSetSelectActive`, `startDraw`, `cancelDraw`, `hasMap`. It **loses** `enterEditMode`, `exitEditMode`, `editing`, `clearSelection`, and the `EditSelection` type.

- [ ] **Step 1: Remove the rivers-only Select from `MapModel`**

In `apps/web/src/features/map/model/MapModel.ts`, delete lines 125-131 (the `selectInteraction` block and `this.selectInteraction = selectInteraction;`):

```ts
    // Thêm interaction để highlight sông khi click
    const selectInteraction = new Select({
      layers: [riversLayer],
      style: makeRiverSelectStyle()
    });
    map.addInteraction(selectInteraction);
    this.selectInteraction = selectInteraction;
```

Then remove the now-unused `selectInteraction` field declaration, any `this.selectInteraction` cleanup in `dispose`, and the `Select` import if nothing else in the file uses it. Keep the `makeRiverSelectStyle` import only if still referenced; otherwise remove it — Task 3's `selectionStyle.ts` imports it from `styles.ts` directly.

Run `npm run lint -w @webatlas/web` after this step and fix any unused-import errors it reports.

- [ ] **Step 2: Point `mapEditing` at the shared selection**

In `apps/web/src/features/map/model/mapEditing.tsx`:

- Delete the `SelectController` import and the `selectRef` ref, its construction in the `useEffect`, and its `dispose()` in the cleanup.
- Delete `enterEditMode`, `exitEditMode`, the `editing` state, and `clearSelection` from both the value object and `MapEditingValue`.
- Delete the `EditSelection` import and its re-export.
- Add `import { useSelection } from '../../../entities/selection';` and read `const { selection } = useSelection();` in the provider body.
- Rewrite `startModify` to use the shared selection's live feature:

```tsx
  const startModify = useCallback((onChange: (g: GeoJSONGeometry) => void) => {
    const f = selection?.feature;
    if (f) modifyRef.current?.start(f, onChange);
  }, [selection]);
```

Keep `startDraw`, `cancelDraw`, `refreshLayer`, `registerRefresh`, `registerSetSelectActive`, `cancelModify`, and `hasMap` exactly as they are.

- [ ] **Step 3: Delete the superseded controller**

```bash
git rm apps/web/src/features/map/model/SelectController.ts apps/web/src/features/map/model/SelectController.test.ts
```

Its behaviour is covered by `SelectionController.test.ts` (Task 3), which tests the same id-parsing and layer-resolution paths.

- [ ] **Step 4: Run the full suite and fix fallout**

Run: `npm test -w @webatlas/web`
Expected: failures in `useEditExistingPresenter.test.ts` and any test importing `enterEditMode`/`EditSelection`. **Do not fix those here** — Task 7 rewrites that presenter. Confirm the failures are confined to the editing presenter and its tests, and that `mapEditing`/`MapModel`-level tests pass.

If any *other* test fails, stop and fix it before continuing — it means something outside editing depended on the removed selection.

- [ ] **Step 5: Commit (with known-failing editing tests)**

This is the one deliberately-red commit in the plan; Task 7 makes it green.

```bash
git add -A apps/web/src/features/map/
git commit -m "refactor(web): retire the two old Select interactions

MapModel's rivers-only Select and the editing-only SelectController are
replaced by the single SelectionController. Editing tests fail until the
presenter is rewritten in the next commit."
```

---

### Task 7: Editing subscribes to selection; modify moves behind the pen

**Files:**
- Modify: `apps/web/src/features/feature-editing/model/useEditExistingPresenter.ts`
- Modify: `apps/web/src/features/feature-editing/model/useEditExistingPresenter.test.ts`

**Interfaces:**
- Consumes: `useSelection` (Task 4), `useMapEditing` (Task 6, reduced surface).
- Produces: presenter returns `{ editing, selection, workingGeometry, confirmOpen, deleting, error, beginEdit, cancelEdit, onSaved, requestDelete, cancelDelete, confirmDelete }`. `beginEdit` is what the pen calls (Task 8).

- [ ] **Step 1: Rewrite the presenter test**

Replace `apps/web/src/features/feature-editing/model/useEditExistingPresenter.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditExistingPresenter } from './useEditExistingPresenter';

const startModify = vi.fn();
const cancelModify = vi.fn();
const refreshLayer = vi.fn();
const clearSelection = vi.fn();

let currentSelection: unknown = null;

vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ startModify, cancelModify, refreshLayer }),
}));

vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({ selection: currentSelection, clear: clearSelection }),
}));

const damSelection = {
  layerKey: 'dams',
  featureId: 'a1',
  feature: { fake: 'feature' },
  isoProps: { geographicalName: 'Hoa Binh' },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSelection = null;
});

describe('useEditExistingPresenter', () => {
  it('is not editing initially and starts no modify interaction', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());

    expect(result.current.editing).toBe(false);
    expect(startModify).not.toHaveBeenCalled();
  });

  it('beginEdit starts geometry modification for the selected feature', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.editing).toBe(true);
    expect(startModify).toHaveBeenCalled();
  });

  it('beginEdit exposes the selection as form values keyed by db column', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.selection?.featureId).toBe('a1');
    expect(result.current.selection?.attributes.length).toBeGreaterThan(0);
    expect(result.current.selection?.initialValues).toBeDefined();
  });

  it('beginEdit does nothing when nothing is selected', () => {
    currentSelection = null;
    const { result } = renderHook(() => useEditExistingPresenter());

    act(() => { result.current.beginEdit(); });

    expect(result.current.editing).toBe(false);
    expect(startModify).not.toHaveBeenCalled();
  });

  it('cancelEdit stops modification but leaves the selection alone', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.cancelEdit(); });

    expect(result.current.editing).toBe(false);
    expect(cancelModify).toHaveBeenCalled();
    expect(clearSelection).not.toHaveBeenCalled();
  });

  it('onSaved refreshes the layer and leaves edit mode', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useEditExistingPresenter());
    act(() => { result.current.beginEdit(); });

    act(() => { result.current.onSaved(); });

    expect(refreshLayer).toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- useEditExistingPresenter`
Expected: FAIL — `beginEdit` / `cancelEdit` are not functions.

- [ ] **Step 3: Rewrite the presenter**

Replace `apps/web/src/features/feature-editing/model/useEditExistingPresenter.ts` with:

```ts
import { useState, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, denormalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { useMapEditing, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { useSelection } from '../../../entities/selection';
import { olGeometryTo4326GeoJSON } from '../../map/model/geo';
import { deleteFeature } from '../api/features.api';

interface SelectionVM {
  layerKey: EditableLayerKey;
  featureId: string;
  attributes: string[];
  initialValues: Record<string, string>;
}

/**
 * Editing SUBSCRIBES to the shared selection; it no longer owns an interaction of its
 * own. Selecting a feature is read-only — geometry becomes modifiable only when the
 * user presses the pen (beginEdit), so browsing results can never nudge a geometry.
 */
export function useEditExistingPresenter() {
  const { startModify, cancelModify, refreshLayer } = useMapEditing();
  const { selection: mapSelection } = useSelection();
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<SelectionVM | null>(null);
  const [workingGeometry, setWorkingGeometry] = useState<GeoJSONGeometry | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    cancelModify();
    setEditing(false);
    setSelection(null);
    setWorkingGeometry(null);
    setConfirmOpen(false);
    setError(null);
  }, [cancelModify]);

  // The pen. Promotes the current read-only selection into an editable one.
  const beginEdit = useCallback(() => {
    if (!mapSelection) return;
    const dbProps = denormalizeFeatureProperties(mapSelection.layerKey, mapSelection.isoProps);
    const attributes = Object.keys(LAYER_ATTRIBUTE_MAP[mapSelection.layerKey].attributes);
    const initialValues: Record<string, string> = {};
    for (const col of attributes) {
      const v = dbProps[col];
      initialValues[col] = v == null ? '' : String(v);
    }
    setSelection({
      layerKey: mapSelection.layerKey,
      featureId: mapSelection.featureId,
      attributes,
      initialValues,
    });
    const geom = mapSelection.feature.getGeometry();
    setWorkingGeometry(geom ? olGeometryTo4326GeoJSON(geom) : null);
    setEditing(true);
    startModify((g) => setWorkingGeometry(g));
  }, [mapSelection, startModify]);

  // Leaves edit mode but keeps the feature selected and highlighted.
  const cancelEdit = useCallback(() => { reset(); }, [reset]);

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
    editing, selection, workingGeometry, confirmOpen, deleting, error,
    beginEdit, cancelEdit, onSaved, requestDelete, cancelDelete, confirmDelete,
  };
}
```

- [ ] **Step 4: Update the editing UI callers**

Open `apps/web/src/features/feature-editing/index.tsx` (and `ui/EditToolbar.view.tsx`, `ui/EditModeToggle.view.tsx` if they reference the removed API). Replace uses of `enter`/`exit`/`editMode` with `beginEdit`/`cancelEdit`/`editing`. The "enter edit mode" toggle no longer gates selection — if `EditModeToggle` exists only to arm selection, remove its usage from the container and leave the component file in place for Task 8 to reconsider.

Run `npm run lint -w @webatlas/web` and fix what it flags.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- useEditExistingPresenter`
Expected: PASS (6 tests).

Run: `npm test -w @webatlas/web`
Expected: PASS — the Task 6 red is now green.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src/features/feature-editing/
git commit -m "refactor(web): editing subscribes to selection; modify behind the pen"
```

---

### Task 8: Display panel widget

**Files:**
- Create: `apps/web/src/widgets/display-panel/index.tsx`
- Create: `apps/web/src/widgets/display-panel/ui/DisplayPanel.view.tsx`
- Create: `apps/web/src/widgets/display-panel/ui/DisplayPanel.view.test.tsx`
- Create: `apps/web/src/widgets/display-panel/model/useDisplayPanelPresenter.ts`
- Create: `apps/web/src/widgets/display-panel/model/useDisplayPanelPresenter.test.ts`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `useSelection` (Task 4), `usePersona` from `entities/persona/usePersona`, `LAYER_LABELS` from `features/attribute-filter/model/layerLabels`, `LAYER_ATTRIBUTE_MAP` from `@webatlas/shared`, `useEditExistingPresenter` (Task 7).
- Produces: `DisplayPanelView` props `{ title, layerLabel, rows, collapsed, canEdit, onToggleCollapse, onClose, children }` where `rows: { label: string; value: string }[]`.

- [ ] **Step 1: Write the failing presenter test**

Create `apps/web/src/widgets/display-panel/model/useDisplayPanelPresenter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDisplayPanelPresenter } from './useDisplayPanelPresenter';

let currentSelection: unknown = null;
let personas: string[] = ['public'];

vi.mock('../../../entities/selection', () => ({
  useSelection: () => ({ selection: currentSelection, clear: vi.fn() }),
}));

vi.mock('../../../entities/persona/usePersona', () => ({
  usePersona: () => ({ available: personas }),
}));

const damSelection = {
  layerKey: 'dams',
  featureId: 'a1',
  feature: { fake: 'f' },
  isoProps: { geographicalName: 'Hoa Binh', statusSlug: 'xa_lu' },
};

beforeEach(() => {
  currentSelection = null;
  personas = ['public'];
});

describe('useDisplayPanelPresenter', () => {
  it('is absent when nothing is selected', () => {
    const { result } = renderHook(() => useDisplayPanelPresenter());
    expect(result.current.visible).toBe(false);
  });

  it('titles the panel with the feature name and tags its layer', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useDisplayPanelPresenter());

    expect(result.current.visible).toBe(true);
    expect(result.current.title).toBe('Hoa Binh');
    expect(result.current.layerLabel).toBe('Đập & Hồ chứa');
  });

  it('falls back to the feature id when the feature has no name', () => {
    currentSelection = { ...damSelection, isoProps: {} };
    const { result } = renderHook(() => useDisplayPanelPresenter());
    expect(result.current.title).toBe('a1');
  });

  it('hides the pen for a viewer and shows it for a steward', () => {
    currentSelection = damSelection;

    const viewer = renderHook(() => useDisplayPanelPresenter());
    expect(viewer.result.current.canEdit).toBe(false);

    personas = ['steward'];
    const steward = renderHook(() => useDisplayPanelPresenter());
    expect(steward.result.current.canEdit).toBe(true);
  });

  it('collapses and expands without dropping the selection', () => {
    currentSelection = damSelection;
    const { result } = renderHook(() => useDisplayPanelPresenter());

    act(() => { result.current.toggleCollapse(); });
    expect(result.current.collapsed).toBe(true);
    expect(result.current.visible).toBe(true);

    act(() => { result.current.toggleCollapse(); });
    expect(result.current.collapsed).toBe(false);
  });

  it('re-expands when a new feature is selected', () => {
    currentSelection = damSelection;
    const { result, rerender } = renderHook(() => useDisplayPanelPresenter());
    act(() => { result.current.toggleCollapse(); });
    expect(result.current.collapsed).toBe(true);

    currentSelection = { ...damSelection, featureId: 'b2' };
    rerender();

    expect(result.current.collapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- useDisplayPanelPresenter`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the presenter**

Create `apps/web/src/widgets/display-panel/model/useDisplayPanelPresenter.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';
import { useSelection } from '../../../entities/selection';
import { usePersona } from '../../../entities/persona/usePersona';
import { LAYER_LABELS } from '../../../features/attribute-filter/model/layerLabels';

export interface DisplayRow {
  label: string;
  value: string;
}

/**
 * Vietnamese labels for the ISO attribute names, so the panel does not show raw db
 * column names. Reuses the wording already in LAYER_FILTER_FIELDS where they overlap;
 * anything unlisted falls back to the db column name.
 */
const FIELD_LABELS: Record<string, string> = {
  geographicalName: 'Tên',
  geographicalNameEn: 'Tên tiếng Anh',
  ratedPower: 'Công suất (MW)',
  annualGeneration: 'Sản lượng năm',
  constructionYear: 'Năm khởi công',
  commissioningYear: 'Năm vận hành',
  operationalStatus: 'Trạng thái',
  hydroId: 'Mã sông',
  streamOrder: 'Cấp sông',
  length: 'Chiều dài (m)',
  measurementType: 'Loại trạm',
  measurementValue: 'Giá trị đo',
  hazardType: 'Loại hiểm họa',
  affectedArea: 'Diện tích ảnh hưởng',
  riskLevel: 'Mức rủi ro',
  observedStatus: 'Trạng thái',
  observationDate: 'Ngày khảo sát',
  salinity: 'Độ mặn',
  catchmentArea: 'Diện tích lưu vực',
};

export function useDisplayPanelPresenter() {
  const { selection, clear } = useSelection();
  const { available } = usePersona();
  const [collapsed, setCollapsed] = useState(false);

  // A NEW selection always re-expands: clicking a result must show what you clicked.
  // Collapsing is a per-feature preference, not a sticky mode.
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selection ? `${selection.layerKey}:${selection.featureId}` : null;
    if (id !== lastIdRef.current) {
      lastIdRef.current = id;
      if (id) setCollapsed(false);
    }
  }, [selection]);

  const rows: DisplayRow[] = useMemo(() => {
    if (!selection) return [];
    // LAYER_ATTRIBUTE_MAP[key].attributes is Record<dbColumn, isoName> — bare strings,
    // verified in packages/shared/src/layer-attributes.ts. Features carry the ISO names.
    const isoByColumn = LAYER_ATTRIBUTE_MAP[selection.layerKey].attributes;
    const out: DisplayRow[] = [];
    for (const [column, iso] of Object.entries(isoByColumn)) {
      // Identity columns are noise in a read-only view.
      if (iso === 'localId') continue;
      const v = selection.isoProps[iso];
      if (v === undefined || v === null || v === '') continue;
      out.push({ label: FIELD_LABELS[iso] ?? column, value: String(v) });
    }
    return out;
  }, [selection]);

  const title = selection
    ? String(selection.isoProps.geographicalName ?? selection.isoProps.localId ?? selection.featureId)
    : '';

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), []);

  return {
    visible: selection !== null,
    collapsed,
    title,
    layerLabel: selection ? LAYER_LABELS[selection.layerKey] : '',
    rows,
    // UX routing only — the backend authorises every write regardless.
    canEdit: available.includes('steward'),
    toggleCollapse,
    close: clear,
  };
}
```

The `attributes` shape is `Record<dbColumn, isoName>` (bare strings) — verified in `packages/shared/src/layer-attributes.ts:10`, e.g. dams maps `wattage_mw -> ratedPower`. Features carry the ISO names, which is why rows look up `selection.isoProps[iso]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- useDisplayPanelPresenter`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing view test**

Create `apps/web/src/widgets/display-panel/ui/DisplayPanel.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayPanelView } from './DisplayPanel.view';

const base = {
  title: 'Hoa Binh',
  layerLabel: 'Đập & Hồ chứa',
  rows: [{ label: 'name', value: 'Hoa Binh' }],
  collapsed: false,
  canEdit: false,
  onToggleCollapse: vi.fn(),
  onEdit: vi.fn(),
  onClose: vi.fn(),
};

describe('DisplayPanelView', () => {
  it('renders the title, layer tag and attribute rows', () => {
    render(<DisplayPanelView {...base} />);
    expect(screen.getByText('Hoa Binh')).toBeInTheDocument();
    expect(screen.getByText('Đập & Hồ chứa')).toBeInTheDocument();
  });

  it('hides the pen unless the user can edit', () => {
    render(<DisplayPanelView {...base} />);
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).not.toBeInTheDocument();
  });

  it('shows the pen and calls onEdit when the user can edit', async () => {
    const onEdit = vi.fn();
    render(<DisplayPanelView {...base} canEdit onEdit={onEdit} />);

    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));

    expect(onEdit).toHaveBeenCalled();
  });

  it('labels the toggle to collapse when expanded', () => {
    render(<DisplayPanelView {...base} />);
    expect(screen.getByRole('button', { name: 'Thu gọn' })).toBeInTheDocument();
  });

  it('labels the toggle to expand and hides the body when collapsed', () => {
    render(<DisplayPanelView {...base} collapsed />);
    expect(screen.getByRole('button', { name: 'Mở rộng' })).toBeInTheDocument();
    expect(screen.queryByText('Hoa Binh')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Implement the view**

Create `apps/web/src/widgets/display-panel/ui/DisplayPanel.view.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, Pencil, X } from 'lucide-react';
import type { DisplayRow } from '../model/useDisplayPanelPresenter';

export function DisplayPanelView({
  title, layerLabel, rows, collapsed, canEdit,
  onToggleCollapse, onEdit, onClose, children,
}: {
  title: string;
  layerLabel: string;
  rows: DisplayRow[];
  collapsed: boolean;
  canEdit: boolean;
  onToggleCollapse: () => void;
  onEdit: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {/* The round button straddles the seam between drawer and panel. It exists only
          while something is selected — it toggles a panel, it is never a lone control. */}
      <button
        type="button"
        className="display-panel-toggle glass-panel"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>

      {!collapsed && (
        <aside className="display-panel glass-panel" aria-label="Chi tiết đối tượng">
          <header className="display-panel-header">
            <div>
              <h2>{title}</h2>
              <span className="display-panel-tag">{layerLabel}</span>
            </div>
            <div className="display-panel-actions">
              {canEdit && (
                <button type="button" onClick={onEdit} aria-label="Chỉnh sửa">
                  <Pencil size={16} />
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Đóng">
                <X size={16} />
              </button>
            </div>
          </header>
          <div className="display-panel-body">
            {children ?? (
              <dl className="display-panel-rows">
                {rows.map((r) => (
                  <div key={r.label} className="display-panel-row">
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
```

- [ ] **Step 7: Run view tests to verify they pass**

Run: `npm test -w @webatlas/web -- DisplayPanel.view`
Expected: PASS (5 tests).

- [ ] **Step 8: Implement the container**

Create `apps/web/src/widgets/display-panel/index.tsx`:

```tsx
import { useDisplayPanelPresenter } from './model/useDisplayPanelPresenter';
import { DisplayPanelView } from './ui/DisplayPanel.view';
import { useEditExistingPresenter } from '../../features/feature-editing/model/useEditExistingPresenter';
import AttributeForm from '../../features/feature-editing/ui/AttributeForm.view';

export default function DisplayPanel() {
  const s = useDisplayPanelPresenter();
  const edit = useEditExistingPresenter();
  if (!s.visible) return null;

  return (
    <DisplayPanelView
      title={s.title}
      layerLabel={s.layerLabel}
      rows={s.rows}
      collapsed={s.collapsed}
      canEdit={s.canEdit}
      onToggleCollapse={s.toggleCollapse}
      onEdit={edit.beginEdit}
      onClose={s.close}
    >
      {edit.editing && edit.selection ? (
        <AttributeForm
          layerKey={edit.selection.layerKey}
          featureId={edit.selection.featureId}
          attributes={edit.selection.attributes}
          initialValues={edit.selection.initialValues}
          geometry={edit.workingGeometry}
          onSaved={edit.onSaved}
          onCancel={edit.cancelEdit}
        />
      ) : undefined}
    </DisplayPanelView>
  );
}
```

**Before running:** open `apps/web/src/features/feature-editing/ui/AttributeForm.view.tsx` and match its real export style (default vs named) and its exact prop names. The props above mirror what `useEditExistingPresenter` produces, but the component is pre-existing — conform to it rather than changing it.

- [ ] **Step 9: Add styles**

Append to `apps/web/src/styles/main.css`. The panel sits to the RIGHT of the drawer and both overlay the map:

```css
/* --- Display panel: attached to the right edge of the left drawer --- */
/* Mirrors .edit-drawer exactly: width 360px at left 12px, top 64px, bottom 12px
   (see the .edit-drawer rule above). The panel therefore starts at 12 + 360 = 372px. */
:root {
  --drawer-left: 12px;
  --drawer-width: 360px;
  --drawer-edge: calc(var(--drawer-left) + var(--drawer-width)); /* 372px */
  --display-panel-width: 340px;
}

.display-panel {
  position: absolute;
  top: 64px;
  bottom: 12px;
  left: var(--drawer-edge);
  width: var(--display-panel-width);
  max-width: 88vw;
  z-index: 1100; /* below the drawer's 1101 so the seam button sits on top */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.display-panel-toggle {
  position: absolute;
  top: 96px;
  left: calc(var(--drawer-edge) - 14px);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 1102; /* straddles the seam, above both panels */
  cursor: pointer;
}

.display-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  flex-shrink: 0;
}

.display-panel-header h2 { font-size: 15px; margin: 0; }

.display-panel-tag {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.75;
}

.display-panel-actions { display: flex; gap: 4px; }
.display-panel-actions button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.display-panel-body { padding: 0 14px 14px; overflow-y: auto; flex: 1; }
.display-panel-rows { margin: 0; }
.display-panel-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.display-panel-row dt { font-size: 12px; opacity: 0.7; }
.display-panel-row dd { font-size: 12px; margin: 0; text-align: right; word-break: break-word; }
```

These values mirror the real `.edit-drawer` rule at `main.css:905-908` (`top: 64px; bottom: 12px; left: 12px; width: 360px; z-index: 1101`). If that rule has since changed, update the custom properties to match — the panel must butt against the drawer's actual edge.

- [ ] **Step 10: Mount it and run everything**

In `apps/web/src/app/App.tsx`, add the import and place it immediately after `<Shell />`:

```tsx
import DisplayPanel from '../widgets/display-panel';
```

```tsx
          <Shell />
          <DisplayPanel />
```

Run: `npm test -w @webatlas/web`
Expected: PASS.

Run: `npm run lint -w @webatlas/web` then `npm run build -w @webatlas/web`
Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/widgets/display-panel/ apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): display panel with collapse toggle and pen-to-edit"
```

---

### Task 9: Filter moves into the drawer; search shares the engine

**Files:**
- Modify: `apps/web/src/features/shell/model/useShellPresenter.ts`
- Modify: `apps/web/src/features/shell/model/useShellPresenter.test.ts`
- Modify: `apps/web/src/features/shell/index.tsx`
- Modify: `apps/web/src/features/shell/ui/EditDrawer.view.tsx`
- Modify: `apps/web/src/features/attribute-filter/index.tsx`
- Modify: `apps/web/src/features/attribute-filter/model/useFilterPresenter.ts`
- Modify: `apps/web/src/features/attribute-filter/model/useFilterPresenter.test.ts`
- Modify: `apps/web/src/features/attribute-filter/model/flyToGeometry.ts`
- Modify: `apps/web/src/features/attribute-filter/model/flyToGeometry.test.ts`
- Modify: `apps/web/src/components/SearchBar.tsx`
- Delete: `apps/web/src/features/attribute-filter/model/searchFeatures.ts`
- Delete: `apps/web/src/features/attribute-filter/model/searchFeatures.test.ts`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `runQuery` (Task 5), `useSelection` (Task 4).
- Produces: `flyToGeometry(map, geom, opts?: { padding?: number[]; maxZoom?: number })`.

- [ ] **Step 1: Write the failing test for fit-based fly-to**

Replace the body of `apps/web/src/features/attribute-filter/model/flyToGeometry.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { flyToGeometry } from './flyToGeometry';

function makeMap() {
  const fit = vi.fn();
  return { map: { getView: () => ({ fit }) }, fit };
}

const lineGeom = { getExtent: () => [0, 0, 100, 50] };

describe('flyToGeometry', () => {
  it('fits the geometry extent rather than centring on a vertex', () => {
    const { map, fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flyToGeometry(map as any, lineGeom as any);
    expect(fit).toHaveBeenCalledWith([0, 0, 100, 50], expect.any(Object));
  });

  it('reserves space on the left so the feature is not hidden behind the panels', () => {
    const { map, fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flyToGeometry(map as any, lineGeom as any, { padding: [40, 40, 40, 700] });
    const opts = fit.mock.calls[0][1];
    expect(opts.padding).toEqual([40, 40, 40, 700]);
  });

  it('caps how far in a tiny geometry zooms', () => {
    const { map, fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flyToGeometry(map as any, { getExtent: () => [10, 10, 10, 10] } as any);
    expect(fit.mock.calls[0][1].maxZoom).toBeGreaterThan(0);
  });

  it('does nothing without a map or geometry', () => {
    const { fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => flyToGeometry(null, lineGeom as any)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => flyToGeometry({ getView: () => ({ fit }) } as any, null)).not.toThrow();
    expect(fit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- flyToGeometry`
Expected: FAIL — the current implementation calls `animate`, not `fit`.

- [ ] **Step 3: Rewrite `flyToGeometry.ts`**

```ts
import type { Map } from 'ol';
import type { Geometry } from 'ol/geom';

/**
 * Left padding reserves the drawer + detail panel, which overlay the map:
 * 12px offset + 360px drawer + 340px panel = 712px, plus a 20px breathing gap.
 * Keep in step with --drawer-width / --display-panel-width in main.css.
 */
export const DEFAULT_FIT_PADDING = [80, 80, 80, 732];
/** Stops a single point from fitting to street level. */
export const DEFAULT_FIT_MAX_ZOOM = 14;

/**
 * Frame a feature. Fits the geometry's EXTENT rather than centring on a coordinate:
 * a fixed centre+zoom lands mid-way along a long river showing no useful context, and
 * a line's getCoordinates() is nested and is not a valid view centre at all.
 */
export function flyToGeometry(
  map: Map | null,
  geom: Geometry | null | undefined,
  opts: { padding?: number[]; maxZoom?: number } = {},
): void {
  if (!map || !geom) return;
  map.getView().fit(geom.getExtent(), {
    padding: opts.padding ?? DEFAULT_FIT_PADDING,
    maxZoom: opts.maxZoom ?? DEFAULT_FIT_MAX_ZOOM,
    duration: 800,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- flyToGeometry`
Expected: PASS (4 tests).

- [ ] **Step 5: Make the drawer universal**

In `apps/web/src/features/shell/model/useShellPresenter.ts`, replace the `hasDrawer` derivation:

```ts
  // The drawer exists for EVERY role now: it hosts the filter, which is a display tool
  // available to all. Role gating moved inside — only the Edit section is steward-only.
  const hasDrawer = true;
  const canEdit = available.includes('steward');
```

Return `canEdit` alongside the existing keys and add it to the return type.

In `apps/web/src/features/shell/model/useShellPresenter.test.ts`, replace any assertion that a viewer gets no drawer with:

```ts
  it('gives every role a drawer, and gates only the edit section', () => {
    // viewer
    const viewer = renderHook(() => useShellPresenter());
    expect(viewer.result.current.hasDrawer).toBe(true);
    expect(viewer.result.current.canEdit).toBe(false);
  });
```

Match the file's existing persona-mocking style — read it before editing.

- [ ] **Step 6: Host filter + edit in the drawer**

In `apps/web/src/features/shell/index.tsx`:

```tsx
import { Menu } from 'lucide-react';
import { useShellPresenter } from './model/useShellPresenter';
import { EditDrawerView } from './ui/EditDrawer.view';
import FeatureEditing from '../feature-editing';
import AttributeFilter from '../attribute-filter';

// The drawer is universal: the filter is a display tool for every role. Editing tools
// are revealed per persona — UX routing only; the backend enforces every write.
export default function Shell() {
  const s = useShellPresenter();
  return (
    <>
      <button
        type="button"
        className="burger-btn glass-panel"
        onClick={s.toggle}
        aria-label="Menu"
        aria-expanded={s.isOpen}
      >
        <Menu size={18} />
      </button>
      <EditDrawerView open={s.isOpen} onClose={s.close}>
        <AttributeFilter />
        {s.canEdit && <FeatureEditing />}
      </EditDrawerView>
    </>
  );
}
```

In `ui/EditDrawer.view.tsx`, change the heading from `Biên tập dữ liệu` to `Công cụ` and the `aria-label` to `Công cụ`, since it is no longer editing-only. Update `EditDrawer.view.test.tsx` if it asserts the old heading.

- [ ] **Step 7: Rewrite the filter presenter over `runQuery`**

In `apps/web/src/features/attribute-filter/model/useFilterPresenter.ts`:

- Import `runQuery`, `DEFAULT_RESULT_CAP`, and `useSelection`.
- Replace the `liveFeatures` + `applyFilter` memo chain with one `runQuery` call:

```ts
  const query = useMemo(
    () => ({ layers: layerKey ? [layerKey] : [], conditions }),
    [layerKey, conditions],
  );

  const queryResult = useMemo(
    () => runQuery(map as OlMap | null, query, DEFAULT_RESULT_CAP),
    // loadTick forces a re-read when a late WFS load changes the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, query, loadTick],
  );
```

- Derive results from `queryResult.hits`, keyed by `featureId`:

```ts
  const results = useMemo(
    () => queryResult.hits.map((h) => ({
      id: h.featureId,
      label: h.label,
      layerLabel: h.layerLabel,
      hasGeometry: !!h.feature.getGeometry(),
    })),
    [queryResult],
  );
```

- Replace `flyTo(id)` with a select-then-frame handler:

```ts
  const { selectById } = useSelection();

  const onResultClick = useCallback((id: string) => {
    const hit = queryResult.hits.find((h) => h.featureId === id);
    if (!hit) return;
    selectById(hit.layerKey, hit.featureId);
    flyToGeometry(map as OlMap | null, hit.feature.getGeometry() as Geometry | null);
  }, [queryResult, selectById, map]);
```

- Return `count: queryResult.total`, `shownCount: results.length`, `unloadedLayers: queryResult.unloadedLayers`, `onResultClick`, and keep `isOpen/layerKey/fields/conditions/activeCount/setLayer/addCondition/updateCondition/removeCondition/clear/open/close`. Replace `layerLoaded` with `unloadedLayers`.
- **Keep the `loadTick` source subscription `useEffect` exactly as it is** — it is what makes enable-to-filter update, and it is still needed.
- Set `op: 'contains'` (not `'eq'`) as the default for new text conditions in `addCondition`, and have `updateCondition` choose `'eq'` for `enum` fields and `'contains'` for `text` fields when the field changes.

Update `useFilterPresenter.test.ts`: replace `layerLoaded` assertions with `unloadedLayers`, replace index ids with real feature ids in the fakes (give each fake feature a `getId()`), and assert that clicking a result calls `selectById`.

- [ ] **Step 8: Update the filter container and panel**

In `apps/web/src/features/attribute-filter/index.tsx`, pass `onResultClick={s.onResultClick}`, `count={s.count}`, `shownCount={s.shownCount}`, and `unloadedLayers={s.unloadedLayers}` instead of `onResultClick={s.flyTo}` and `layerLoaded`. Keep the existing idempotent `onEnableLayer` logic verbatim.

In `ui/FilterPanel.view.tsx`, replace the `layerLoaded` prop with `unloadedLayers`, render the enable prompt when the active layer appears in it, and show `hiển thị {shownCount} / {count}` above the list when `shownCount < count`. Update `FilterPanel.view.test.tsx` accordingly.

- [ ] **Step 9: Rewrite `SearchBar` over the shared engine**

Replace the query/result logic in `apps/web/src/components/SearchBar.tsx` so it calls `runQuery(map, { layers: 'all', conditions: [{ field: 'geographicalName', op: 'contains', value: q }] })`, and its result click does exactly what the filter's does:

```tsx
  const onHitClick = (hit: QueryHit) => {
    selectById(hit.layerKey, hit.featureId);
    flyToGeometry(map, hit.feature.getGeometry() as Geometry | null);
    setQuery('');
  };
```

Delete the `searchAllLayers` import. Keep the `Tìm kiếm...` placeholder and the layer-tagged result rows.

```bash
git rm apps/web/src/features/attribute-filter/model/searchFeatures.ts apps/web/src/features/attribute-filter/model/searchFeatures.test.ts
```

- [ ] **Step 10: Drop the filter's own button/panel CSS**

The filter no longer floats beside the search bar. In `apps/web/src/styles/main.css`, remove the absolute positioning from `.attribute-filter` and the `.filter-panel` `position: absolute; right: 0;` rules so both flow inside the drawer body. Keep the search bar's own `top`/`z-index` rules from the earlier fix.

- [ ] **Step 11: Run everything**

Run: `npm test -w @webatlas/web`
Expected: PASS.

Run: `npm run lint -w @webatlas/web` then `npm run build -w @webatlas/web`
Expected: both exit 0.

- [ ] **Step 12: Commit**

```bash
git add -A apps/web/src/
git commit -m "feat(web): filter moves into the drawer; search shares the query engine"
```

---

### Task 10: Manual verification (/run)

Confirm the whole flow against the live stack. Evidence per design §Testing.

**Files:** none.

- [ ] **Step 1: Bring the stack up**

Start Postgres + GeoServer (`docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`) and the web dev server (`npm run dev:web`). The API is needed only for the steward save path (Step 5).

- [ ] **Step 2: Filter from the drawer as a viewer**

Logged out, open the burger drawer — it must appear (it previously did not for viewers). Pick **Đập & Hồ chứa**, add **Trạng thái = xa_lu**, then **Công suất ≥ 200**; the list narrows. Confirm the header shows `hiển thị N / M` when results are capped.

- [ ] **Step 3: Result click selects, frames and opens the panel**

Click a result. Confirm: the feature is highlighted on the map; the map frames it (a river fits its whole length, not a mid-point); the detail panel opens to the right of the drawer showing name, layer tag and attributes; the feature is **not** hidden behind the panels.

- [ ] **Step 4: Collapse and expand**

Press the round `<<` button. The panel folds, the button flips to `>>`, and the map highlight **stays**. Press `>>` to restore. Click a different result and confirm the panel re-expands automatically.

- [ ] **Step 5: Steward pen flow**

Log in as an editor. Filter → click a result → panel shows a pen. Before pressing it, try to drag the geometry: it must **not** move. Press the pen: the attribute form appears and the geometry becomes draggable. Edit a field, save, confirm the layer refreshes. Repeat and press cancel: edit mode exits, the selection and highlight remain.

- [ ] **Step 6: Cross-layer search**

With rivers and dams on, search `Sông Ba` in the top bar. Confirm hits from more than one layer, each tagged with its Vietnamese layer label, and that clicking one behaves **identically** to a filter result (highlight + frame + panel).

- [ ] **Step 7: Unloaded layers are visible, not silent**

Turn a layer off, then query it. Confirm the panel says the layer is not enabled rather than showing an empty list, and that enabling it makes results appear.

- [ ] **Step 8: Map view bounds**

Zoom all the way out. Confirm the whole of Vietnam is visible — Cà Mau in the south and Hà Giang in the north — and that you cannot zoom out further or pan beyond the country. Confirm the zoom-out button disables at the same point the scroll wheel stops (they previously disagreed). Press the home button and confirm the default view returns.

- [ ] **Step 9: Record the result**

Note anything cosmetic (panel width, seam alignment, the toggle's vertical position) for follow-up. Blockers are: selection not highlighting, the panel hiding the framed feature, geometry draggable before the pen, or the country not fully reachable.

---

## Self-Review

**1. Spec coverage (design §1–§5):**
- §1 selection entity, one interaction replacing two, `selectById`, editing subscribes, no modify on select → Tasks 2, 3, 4, 6, 7 ✓
- §2 drawer universal with role-gated sections, panel attached right, round `<<`/`>>` seam button, collapsed ≠ deselected, new selection re-expands, both overlay → Tasks 8, 9 ✓
- §3 read-only by default, title/tag/attributes, pen on `steward` persona, pen couples form + modify, cancel keeps selection → Tasks 7, 8 ✓
- §4 one `Query`/`runQuery`, identical click behaviour, `view.fit` with padding + maxZoom, feature-identity ids, `eq`/`contains` split, empty conditions return all, cap as display concern with `N / M`, unloaded layers surfaced → Tasks 5, 9 ✓
- §5 shared zoom constants, Vietnam extent, zoom floor, out-of-scope layer styling untouched → Task 1 ✓

**2. Placeholder scan:** none. Every code step carries real code; every command states its expected result. Values that could have been guesses were verified against the source instead: `attributes` is `Record<dbColumn, isoName>` (`layer-attributes.ts:10`), and the panel's geometry is derived from the real `.edit-drawer` rule (`main.css:905-908`). Three steps still say "read the file first and conform" (Task 3 Step 4 `makeRiverSelectStyle`'s signature, Task 4 Step 6 provider nesting, Task 8 Step 8 `AttributeForm` props) — these are pre-existing interfaces with their own tests, so the plan names the exact file to open rather than dictating a shape that would break them.

**3. Type/name consistency:** `Selection` (Task 2) is consumed unchanged in Tasks 3, 4, 7, 8. `SelectionController`'s `activate(onChange)`/`selectById`/`clear`/`dispose` (Task 3) match the provider's usage (Task 4). `useSelection()` returns `{ selection, selectById, clear }` in Tasks 4, 7, 8, 9 identically. `Operator` gains `'contains'` in Task 5 and is used with that spelling in Tasks 5 and 9. `QueryHit.featureId`/`layerKey`/`layerLabel`/`label`/`feature` (Task 5) are read with those names in Task 9. `flyToGeometry(map, geom, opts)` (Task 9 Step 3) is called with that arity in Task 9 Steps 7 and 9. `beginEdit`/`cancelEdit`/`editing` (Task 7) are the names the panel container calls (Task 8 Step 8). `DisplayRow` (Task 8) is imported by the view from the presenter module.

**4. Risks for the implementer:**

- **Task 6 commits red on purpose.** It is the only such commit and Task 7 immediately fixes it. If you are running tasks out of order, run 6 and 7 together.
- **`AttributeForm.view.tsx` props are pre-existing** (Task 8 Step 8). Conform the container to the component, not the reverse — that component has its own tests. This is the one interface the plan does not pin down, because changing it would break its existing tests.
- **Panel geometry is derived, not guessed** (Task 8 Step 9): `.edit-drawer` is `left: 12px; width: 360px; top: 64px; bottom: 12px; z-index: 1101` (`main.css:905-908`), so the panel starts at 372px and `DEFAULT_FIT_PADDING`'s left value is 732. If either width changes, update both the CSS custom properties and that constant together — they encode the same fact in two places.
- **Two z-index bands matter here.** The drawer is 1101 and the search bar is 1100. The panel takes 1100 and the seam button 1102, so the button stays clickable above both panels. Do not raise the panel above the drawer, or the seam button's position will read as belonging to the wrong panel.
- **`MAP_MIN_ZOOM = 5.5` is an estimate.** Vietnam's bbox is tall and narrow, so the exact floor that fits the country depends on viewport aspect. Tune it in Task 10 Step 8 and update the constant.
- **`view.fit` on a Point** produces a zero-area extent; OL handles this via `maxZoom`, which is why `DEFAULT_FIT_MAX_ZOOM` is not optional in practice. Do not remove it.
