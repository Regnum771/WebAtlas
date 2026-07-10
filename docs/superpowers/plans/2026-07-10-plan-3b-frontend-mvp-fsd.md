# Plan 3b — Frontend MVP + Feature-Sliced Design (Map model extraction) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the Feature-Sliced Design structure and MVP roles to `apps/web`, quarantining all imperative OpenLayers code out of `MapContainer` into a framework-agnostic `MapModel` (the design's "hard part"), and add a typed feature-property model — while leaving the viewer visually and behaviourally identical.

**Architecture (this plan's slice):** Establish `app/ · shared/ · entities/ · features/`. Add a typed, discriminated feature-property model in `@webatlas/shared`. Create `entities/layer` (the layer registry + groups) and `features/map/model` (`MapModel` class + pure `styles` + the WFS source). `MapContainer` becomes a thin `features/map/ui/MapView` that owns no `ol/*` calls; `MapContext` becomes `app/providers/MapProvider` keeping the **same context API** so the existing panels keep working unchanged (their MVP split is deferred to Plan 3c).

**Tech Stack:** React 19, OpenLayers 10, TypeScript, Vite; `@webatlas/shared`.

## Global Constraints

- Node 22 / npm 10 workspaces. Touches `apps/web` and `packages/shared`.
- Requires Plans 1–3 available; the Docker stack (PostGIS + GeoServer with CORS) up for the `/run` parity check.
- **Behaviour parity is mandatory:** every task ends with `npm run build:web` + `npm run lint:web` clean, and the final task re-runs the browser `/run` parity check (dams/rivers/hazards render from WFS, dam popup shows ISO fields). The public viewer must look and behave exactly as at the end of Plan 3.
- **MVP quarantine rule:** after this plan, `ol/*` is imported ONLY under `features/map/model/`. `MapView`, `MapProvider`, and panels contain no direct `ol/*` map construction (panels may still call methods on the OL `map` exposed by the provider — that compat surface is removed in Plan 3c).
- **Scope boundary:** the seven panels (`LayerTree`, `BasemapSwitcher`, `MapControls`, `SearchBar`, `DynamicPopup`, `DynamicLegend`, `OGCClient`) are NOT split into presenter/view here — that is Plan 3c. They keep their current code and continue to consume `useMapContext` (re-exported for compatibility).
- **INV-4:** the typed feature-property model derives from `LAYER_ATTRIBUTE_MAP`; no duplicated name lists.

## Target structure (end state of this plan)

```
apps/web/src/
  app/
    App.tsx                         # moved from src/App.tsx
    providers/MapProvider.tsx       # was components/MapContext.tsx (same API)
  shared/
    config.ts                       # moved from src/config.ts
  entities/
    layer/
      layerRegistry.ts              # layerStateId <-> layerKey <-> wfsTypeName + layerGroups
  features/
    map/
      model/
        MapModel.ts                 # ALL OpenLayers map logic (class)
        styles.ts                   # pure OL style functions + palette
        wfsSource.ts                # moved from src/services/wfs.ts
      ui/
        MapView.tsx                 # thin; was components/MapContainer.tsx
  components/                        # panels stay here until Plan 3c
    BasemapSwitcher.tsx LayerTree.tsx MapControls.tsx SearchBar.tsx
    DynamicPopup.tsx DynamicLegend.tsx OGCClient.tsx
  data/mockData.ts                   # only layerGroups remains (re-exported by entities/layer)
  main.tsx  index.css  styles/
```

---

### Task 1: Typed feature-property model in `@webatlas/shared`

**Files:**
- Create: `packages/shared/src/feature-properties.ts`
- Create: `packages/shared/src/feature-properties.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export); `packages/shared/src/layer-attributes.ts` (type the normalizer return)

**Interfaces:**
- Produces: per-layer property interfaces (`DamProperties`, `RiverProperties`, `StationProperties`, `FloodZoneProperties`, `DroughtPointProperties`, `SaltwaterIntrusionProperties`, `FloodGenerationProperties`), a discriminated union `LayerFeatureProperties` (discriminant `layerKey`), and `normalizeFeatureProperties(...)` now returns `LayerFeatureProperties`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/feature-properties.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeFeatureProperties } from './layer-attributes';
import type { LayerFeatureProperties, DamProperties } from './feature-properties';

describe('typed feature properties', () => {
  it('normalizeFeatureProperties returns a layerKey-discriminated type usable via narrowing', () => {
    const p: LayerFeatureProperties = normalizeFeatureProperties('dams', {
      id: 'u1', external_id: 1, name: 'Hoa Binh', wattage_mw: 1920,
    });
    expect(p.layerKey).toBe('dams');
    if (p.layerKey === 'dams') {
      const dam: DamProperties = p; // compiles only if the union narrows correctly
      expect(dam.ratedPower).toBe(1920);
      expect(dam.geographicalName).toBe('Hoa Binh');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npm run test:shared`
Expected: FAIL — `feature-properties` module does not exist.

- [ ] **Step 3: Implement the typed model**

Create `packages/shared/src/feature-properties.ts`:
```ts
import type { EditableLayerKey } from './index';

/** Common properties present on every normalized thematic feature. */
export interface BaseFeatureProperties {
  layerKey: EditableLayerKey;
  id?: string;            // uuid (present for CRUD)
  localId?: number | string;
  geographicalName?: string;
}

export interface DamProperties extends BaseFeatureProperties {
  layerKey: 'dams';
  geographicalNameEn?: string;
  ratedPower?: number;
  annualGeneration?: number;
  constructionYear?: string;
  commissioningYear?: string;
  operationalStatus?: string;
}
export interface RiverProperties extends BaseFeatureProperties {
  layerKey: 'rivers';
  hydroId?: string;
  streamOrder?: number;
  length?: number;
}
export interface StationProperties extends BaseFeatureProperties {
  layerKey: 'stations';
  measurementType?: string;
  operationalStatus?: string;
  measurementValue?: string;
}
export interface FloodZoneProperties extends BaseFeatureProperties {
  layerKey: 'flood_zones';
  hazardType?: string;
  affectedArea?: string;
  riskLevel?: string;
}
export interface DroughtPointProperties extends BaseFeatureProperties {
  layerKey: 'drought_points';
  riskLevel?: string;
  observedStatus?: string;
  observationDate?: string;
}
export interface SaltwaterIntrusionProperties extends BaseFeatureProperties {
  layerKey: 'saltwater_intrusion';
  salinity?: string;
  riskLevel?: string;
  observedStatus?: string;
}
export interface FloodGenerationProperties extends BaseFeatureProperties {
  layerKey: 'flood_generation';
  riskLevel?: string;
  catchmentArea?: string;
  flowCharacteristics?: string;
}

export type LayerFeatureProperties =
  | DamProperties | RiverProperties | StationProperties | FloodZoneProperties
  | DroughtPointProperties | SaltwaterIntrusionProperties | FloodGenerationProperties;
```

- [ ] **Step 4: Type the normalizer return + re-export**

In `packages/shared/src/layer-attributes.ts`, change the signature of `normalizeFeatureProperties` to return the typed union:
```ts
import type { LayerFeatureProperties } from './feature-properties';
// ...
export function normalizeFeatureProperties(
  layerKey: EditableLayerKey,
  dbProps: Record<string, unknown>
): LayerFeatureProperties {
  // ...body unchanged...
  out.layerKey = layerKey;
  return out as LayerFeatureProperties;
}
```
In `packages/shared/src/index.ts`, append:
```ts
export * from './feature-properties';
```

- [ ] **Step 5: Run tests + build to verify PASS**

Run: `npm run test:shared` then `npm run build:shared`
Expected: all shared tests pass; declarations emit `feature-properties`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): typed layerKey-discriminated feature properties"
```

---

### Task 2: FSD scaffolding — `entities/layer`, `shared/config`, move the WFS source

**Files:**
- Create: `apps/web/src/entities/layer/layerRegistry.ts`
- Move: `apps/web/src/config.ts` → `apps/web/src/shared/config.ts`
- Move: `apps/web/src/services/wfs.ts` → `apps/web/src/features/map/model/wfsSource.ts`
- Modify: importers of the moved files (`SearchBar.tsx`, and later `MapModel`).

**Interfaces:**
- Produces: `entities/layer/layerRegistry.ts` exporting `LAYER_REGISTRY` (array of `{ layerKey, layerStateId, wfsTypeName }` from `LAYER_ATTRIBUTE_MAP`) and `layerGroups` (re-exported from `data/mockData`); `shared/config.ts` (`GEOSERVER_URL`); `features/map/model/wfsSource.ts` (`createWfsVectorSource`).

- [ ] **Step 1: Move config and the WFS source with git**

Run from repo root:
```bash
mkdir -p apps/web/src/shared apps/web/src/entities/layer apps/web/src/features/map/model apps/web/src/features/map/ui apps/web/src/app/providers
git mv apps/web/src/config.ts apps/web/src/shared/config.ts
git mv apps/web/src/services/wfs.ts apps/web/src/features/map/model/wfsSource.ts
```

- [ ] **Step 2: Fix the WFS source's import of config**

In `apps/web/src/features/map/model/wfsSource.ts`, update the config import path:
```ts
import { GEOSERVER_URL } from '../../../shared/config';
```

- [ ] **Step 3: Create the layer registry entity**

Create `apps/web/src/entities/layer/layerRegistry.ts`:
```ts
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
export { layerGroups } from '../../data/mockData';

export interface LayerRegistryEntry {
  layerKey: EditableLayerKey;
  layerStateId: string;
  wfsTypeName: string;
}

export const LAYER_REGISTRY: LayerRegistryEntry[] = EDITABLE_LAYER_KEYS.map((layerKey) => ({
  layerKey,
  layerStateId: LAYER_ATTRIBUTE_MAP[layerKey].layerStateId,
  wfsTypeName: LAYER_ATTRIBUTE_MAP[layerKey].wfsTypeName,
}));
```

- [ ] **Step 4: Repoint the SearchBar imports**

In `apps/web/src/components/SearchBar.tsx`, update the config import:
```ts
import { GEOSERVER_URL } from '../shared/config';
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build:web` then `npm run lint:web`
Expected: both clean (config + wfsSource resolve from their new homes; `MapContainer` still imports `../services/wfs` — fix in Task 3, so if build breaks here on that path, that's expected and resolved next; to keep this task green, also update MapContainer's import now):

In `apps/web/src/components/MapContainer.tsx` update:
```ts
import { createWfsVectorSource } from '../features/map/model/wfsSource';
```

Re-run `npm run build:web` + `npm run lint:web` → clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): scaffold FSD dirs; move config + WFS source; add layer registry"
```

---

### Task 3: Extract `MapModel` + pure `styles` (quarantine OpenLayers)

**Files:**
- Create: `apps/web/src/features/map/model/styles.ts`
- Create: `apps/web/src/features/map/model/MapModel.ts`
- Modify (reduced): `apps/web/src/components/MapContainer.tsx` (becomes a thin delegator — replaced entirely in Task 4)

**Interfaces:**
- Produces: `styles.ts` exporting the pure style functions + `provinceColors` + `hashCode`, with the dams style built by a factory `makeDamsStyle(getReservoirFilter: () => ReservoirFilterType)`. `MapModel` class with the surface below. `ol/*` is imported only in these two files (+ `wfsSource.ts`).

**MapModel public surface (behaviour moved verbatim from `MapContainer`):**
```ts
export type BasemapType = 'satellite' | 'street' | 'dem';
export type ReservoirFilterType = 'all' | 'binh_thuong' | 'xa_lu' | 'nguy_hiem';

export class MapModel {
  init(target: HTMLElement): void;      // builds View, basemap, 10 layers, Select interaction; starts moveend listener
  getMap(): import('ol/Map').default;   // transitional: panels still use the raw OL map
  setBasemap(type: BasemapType): void;  // was the basemap useEffect switch
  applyLayerStates(states: { id: string; visible: boolean; opacity: number }[]): void; // was the layersState + zoom-visibility effect
  setReservoirFilter(filter: ReservoirFilterType): void; // stores filter + redraws dams layer
  dispose(): void;                      // removes interactions, setTarget(undefined)
}
```

- [ ] **Step 1: Create `styles.ts` by moving the style code out of `MapContainer`**

Create `apps/web/src/features/map/model/styles.ts`. Move, **unchanged in behaviour**, from `MapContainer.tsx`: `provinceColors`, `hashCode`, `provincesStyle`, `wardsStyle`, `riversStyle`, `stationsStyle`, `floodStyle`, `droughtSurveyStyle`, `saltwaterIntrusionStyle`, `floodGenerationStyle`, and the rivers `Select` highlight style. Convert the dams style (which reads the live reservoir filter) into a factory:
```ts
import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import type { ReservoirFilterType } from './MapModel';

export function makeDamsStyle(getReservoirFilter: () => ReservoirFilterType) {
  return (feature: any) => {
    const id = feature.get('localId') || 0;
    const wattage = feature.get('ratedPower') || 50;
    // ... identical status-derivation + feature.set('operationalStatus', status) ...
    const currentFilter = getReservoirFilter();
    // ... identical filter early-returns + radius + Style ...
  };
}
// export the other style fns + provinceColors + hashCode + a makeRiverSelectStyle() unchanged
```
Keep every numeric/colour value identical to the current `MapContainer` code.

- [ ] **Step 2: Create `MapModel.ts` by moving the OL construction out of `MapContainer`**

Create `apps/web/src/features/map/model/MapModel.ts`. Move the map/layer/interaction logic from `MapContainer`'s first `useEffect` and the three reactive `useEffect`s into the class methods per the surface above:
- `init(target)`: build `initialBasemap` (CartoDB), the `createVectorLayerFromUrl` GADM layers (provinces/wards) and the WFS layers (`createWfsVectorSource('dams'|...)`), the `View` (center/zoom/extent/controls), the `Select` interaction; store `map`, `basemapLayer`, and a `layers: Record<string, VectorLayer>` map (the old `layersRef`). Start the `moveend` listener that drives zoom-based ward visibility.
- `setBasemap(type)`: the basemap `switch` that sets a new `XYZ`/`OSM` source on `basemapLayer`.
- `applyLayerStates(states)`: the old `updateLayersVisibility` logic (per-layer `setVisible(state.visible && zoomVisible)` + `setOpacity`).
- `setReservoirFilter(filter)`: store the filter (the value `makeDamsStyle`'s getter returns) and call `layers['layer_dams'].changed()`.
- `dispose()`: remove the select interaction and `map.setTarget(undefined)`.
Import styles from `./styles` and the WFS source from `./wfsSource`. This file (plus `styles.ts`, `wfsSource.ts`) are the ONLY `ol/*` importers going forward.

- [ ] **Step 3: Point `MapContainer` at `MapModel` temporarily (bridge)**

Rewrite `apps/web/src/components/MapContainer.tsx` to a thin delegator that constructs a `MapModel`, so the app keeps working before Task 4 renames it:
```tsx
import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import { useMapContext } from './MapContext';
import { MapModel } from '../features/map/model/MapModel';

const MapContainer: React.FC = () => {
  const el = useRef<HTMLDivElement>(null);
  const modelRef = useRef<MapModel | null>(null);
  const { setMap, basemap, layersState, reservoirFilter } = useMapContext();

  useEffect(() => {
    if (!el.current) return;
    const model = new MapModel();
    model.init(el.current);
    modelRef.current = model;
    setMap(model.getMap());
    return () => model.dispose();
  }, []);

  useEffect(() => { modelRef.current?.setBasemap(basemap); }, [basemap]);
  useEffect(() => { modelRef.current?.applyLayerStates(layersState); }, [layersState]);
  useEffect(() => { modelRef.current?.setReservoirFilter(reservoirFilter); }, [reservoirFilter]);

  return <div ref={el} className={`map-container basemap-${basemap}`} />;
};
export default MapContainer;
```
> The `applyLayerStates` effect replaces the old `moveend`-bound closure in the component; the `moveend`→ward-visibility recompute now lives inside `MapModel.init` (it re-reads the stored layer states on each `moveend`). Ensure `MapModel` keeps the last-applied states so `moveend` recomputes correctly.

- [ ] **Step 4: Verify build + lint**

Run: `npm run build:web` then `npm run lint:web`
Expected: both clean. `ol/*` now appears only under `features/map/model/`. If lint flags `any` on style `feature` params, keep the existing `any` (parity; typing styles is Plan 3c).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(web): extract MapModel + pure styles; quarantine OpenLayers"
```

---

### Task 4: `MapView` + `MapProvider` + `app/App` (rename to FSD homes)

**Files:**
- Create: `apps/web/src/features/map/ui/MapView.tsx` (from the Task 3 `MapContainer`)
- Create: `apps/web/src/app/providers/MapProvider.tsx` (from `components/MapContext.tsx`, same API)
- Create: `apps/web/src/app/App.tsx` (from `src/App.tsx`)
- Delete: `apps/web/src/components/MapContainer.tsx`, `apps/web/src/components/MapContext.tsx`, `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`; all panels' `useMapContext` import path; `MapModel`/`styles` `BasemapType`/`ReservoirFilterType` source.

**Interfaces:**
- Produces: `app/providers/MapProvider.tsx` exporting `MapProvider` + `useMapContext` with the **identical** context shape as today (`map, setMap, basemap, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity, reservoirFilter, setReservoirFilter`). Types `BasemapType`/`ReservoirFilterType` are re-exported from here (imported from `features/map/model/MapModel`).

- [ ] **Step 1: Create `MapProvider` from `MapContext`**

`git mv apps/web/src/components/MapContext.tsx apps/web/src/app/providers/MapProvider.tsx`. Update it: import the map types from the model instead of defining them locally:
```ts
import { Map } from 'ol';
import type { BasemapType, ReservoirFilterType } from '../../features/map/model/MapModel';
import { layerGroups } from '../../entities/layer/layerRegistry';
export type { BasemapType, ReservoirFilterType };
```
Rename the component export to `MapProvider` (keep `useMapContext`). Keep the rest of the context body identical (state init from `layerGroups`, toggles, provider value).

- [ ] **Step 2: Create `MapView` from the bridge `MapContainer`**

`git mv apps/web/src/components/MapContainer.tsx apps/web/src/features/map/ui/MapView.tsx`. Update its imports:
```ts
import { useMapContext } from '../../../app/providers/MapProvider';
import { MapModel } from '../model/MapModel';
```

- [ ] **Step 3: Create `app/App.tsx`**

`git mv apps/web/src/App.tsx apps/web/src/app/App.tsx`. Update its imports:
```ts
import { MapProvider } from './providers/MapProvider';
import MapView from '../features/map/ui/MapView';
// panels still from ../components/*
```
Replace `<MapContainer />` usage with `<MapView />` and `<MapProvider>` wrapper (was `<MapProvider>` already — keep).

- [ ] **Step 4: Repoint `main.tsx` and every panel's context import**

In `apps/web/src/main.tsx`:
```ts
import App from './app/App.tsx'
```
In each panel that imports `./MapContext` (`LayerTree.tsx`, `BasemapSwitcher.tsx`, `MapControls.tsx`, `SearchBar.tsx`, `DynamicPopup.tsx`, `DynamicLegend.tsx`), change:
```ts
import { useMapContext } from './MapContext';
// (BasemapSwitcher also imports the BasemapType)
```
to:
```ts
import { useMapContext } from '../app/providers/MapProvider';
```
and for `BasemapSwitcher.tsx`:
```ts
import { useMapContext, type BasemapType } from '../app/providers/MapProvider';
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build:web` then `npm run lint:web`
Expected: both clean. No file under `components/`, `app/`, or `features/map/ui` imports `ol/*` for map construction (only `MapView` imports `ol/ol.css`, which is allowed).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): FSD homes for MapView, MapProvider, App"
```

---

### Task 5: Convention guard + final parity verification

**Files:**
- Create: `apps/web/src/features/map/model/README.md` (one-paragraph note: OL lives only here)
- Verify only: build, lint, `/run`

- [ ] **Step 1: Assert the OL quarantine**

Run from repo root:
```bash
grep -rln "from 'ol/" apps/web/src | sort
```
Expected: every path is under `apps/web/src/features/map/model/` (`MapModel.ts`, `styles.ts`, `wfsSource.ts`) — plus `features/map/ui/MapView.tsx` may match only `import 'ol/ol.css'`. If any panel or provider still imports `ol/*` for logic, move it into `MapModel`.

- [ ] **Step 2: Document the boundary**

Create `apps/web/src/features/map/model/README.md`:
```md
# map/model — the only place OpenLayers lives

`MapModel` owns the OL `Map`, layers, styles, and interactions. Views/presenters/panels
call `MapModel` methods; they never import `ol/*`. The provider exposes the raw OL `map`
transitionally for panels not yet migrated (Plan 3c removes that surface).
```

- [ ] **Step 3: Build + lint**

Run: `npm run build:web` && `npm run lint:web` → both clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(web): document the OpenLayers quarantine boundary"
```

- [ ] **Step 5: Controller `/run` parity check (performed by the controller, not a subagent)**

The controller starts `npm run dev:web` (stack up) and drives headless chromium to confirm: dams (sized/coloured circles) + rivers render correctly projected; hazard layers toggle on; a dam popup shows the ISO fields (`ratedPower`, `operationalStatus`, `annualGeneration`, `commissioningYear`); zoom/basemap/layer toggles/measure/search still work; no console errors. This must match the Plan 3 parity screenshots exactly (identical behaviour).

---

## Self-Review

**1. Spec coverage (design §7.1–7.2, INV-4):**
- MVP Model quarantine (OL only in `features/map/model`) → Tasks 3–5 ✓
- FSD layout (`app/ · shared/ · entities/ · features/`) → Tasks 2–4 ✓
- Typed feature properties derived from `LAYER_ATTRIBUTE_MAP` (INV-4) → Task 1 ✓
- Behaviour parity gate → every task builds/lints; Task 5 `/run` ✓
- **Deferred (stated, not gaps):** panels → presenter/view split is **Plan 3c**; `shared/ui`, `entities/session`, TanStack Query, and the API client arrive with Plan 4/3c.

**2. Placeholder scan:** The style/`MapModel` bodies are moved (not rewritten) from `MapContainer`; Task 3 specifies the exact functions/effects that move and their target methods rather than reproducing ~470 lines — appropriate for a behaviour-preserving refactor. No TBD/TODO.

**3. Name consistency:** `BasemapType`/`ReservoirFilterType` are defined once in `MapModel` and re-exported by `MapProvider`; `useMapContext`'s shape is unchanged so panels compile without edits beyond the import path. `layerStateId` values in `LAYER_REGISTRY` come from `LAYER_ATTRIBUTE_MAP` (single source).

**4. Risks for the implementer:**
- The reservoir filter must keep working: `makeDamsStyle` reads a live getter that `MapModel.setReservoirFilter` updates before calling `dams.changed()` — verify a dam re-styles when a filter button is clicked (the `/run` check).
- `moveend` ward-visibility: `MapModel` must retain the last `applyLayerStates` input so the `moveend` handler recomputes `visible && zoomVisible` correctly (the old component recomputed from `layersState` on every `moveend`).
- React 19 StrictMode double-invokes effects in dev: `MapModel.init`/`dispose` must be idempotent (dispose fully tears down so a second init doesn't double-add layers). The old `MapContainer` already handled this via cleanup; preserve it.

---

## Follow-on

- **Plan 3c** — split the seven panels into passive `*.view.tsx` + `use*Presenter` hooks under `features/*`, move map interactions (zoom/draw/flyTo/click) from panels onto `MapModel` methods, and remove the transitional raw-`map` exposure from the provider. Type `feature.get` against `LayerFeatureProperties`.
- **Plan 4** — API control plane (auth + users); `shared/api/apiClient`, `entities/session`.
