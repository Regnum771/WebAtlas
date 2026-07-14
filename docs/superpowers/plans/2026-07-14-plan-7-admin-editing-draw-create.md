# Plan 7 — Admin Map Editing: Draw-to-Create (Part 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated admin add a new feature to any of the 7 editable thematic layers — pick a layer, draw its geometry, fill a schema-driven attribute form, save to the Plan 5 feature-CRUD API, and see the feature appear live via a WFS refetch.

**Architecture:** Feature-Sliced Design + MVP, matching the existing frontend. A new `features/admin-editing` slice holds presenters (view-model + handlers, no JSX/fetch/`ol/*`) and passive `*.view.tsx` views. All OpenLayers stays quarantined in `features/map/model/`: a new `DrawController` (owns the OL `Draw` interaction + a temp edit layer) and a pure `geo.ts` (3857↔4326 + OL-geom↔GeoJSON). A React `MapEditingProvider`/`useMapEditing()` bridge (in `features/map`, the OL boundary) exposes **non-OL** methods (`startDraw`, `cancelDraw`, `refreshLayer`, `hasMap`) so the admin-editing presenters drive drawing without importing `ol/*`. Feature writes go through the Plan 6 `apiRequest` (JWT attached); the backend is the real authorization boundary — `RequireRole('admin')` gates the toolbar as UX only.

**Tech Stack:** React 19, TypeScript (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals/Parameters`), OpenLayers 10, `@webatlas/shared`, the Plan 6 `apiClient`/`session`, Vitest + `@testing-library/react` + `jsdom`. API: `GET /api/layers`, admin-only `POST /api/layers/:key/features`.

## Global Constraints

- Node 22 / npm 10 workspaces. Frontend work in `apps/web`; one shared helper + test in `packages/shared`. Base branch: current `main` (Plan 5 API + Plan 6 auth are merged).
- **`@webatlas/shared` is consumed from `dist/`** (`"main": "./dist/index.js"`). After editing `packages/shared/src/*`, you MUST rebuild it: `npm run build:shared`. Commit the regenerated `dist/*` files alongside the source (the repo already tracks `dist/`).
- **Hard invariants (design §2):**
  1. **Only the 7 editable layers are editable.** The layer picker is sourced exclusively from `GET /api/layers` (equivalently `EDITABLE_LAYER_KEYS`). The GADM base layers (`layer_provinces_2026`, `layer_wards_2026`) are not in `EDITABLE_LAYER_KEYS`, have no API write path, and must never appear in the picker.
  2. **Backend is the authorization boundary.** Every write goes through `apiRequest` (JWT). `RequireRole('admin')` gating the toolbar is UX only (carry the standard comment), never a security control.
  3. **OpenLayers stays quarantined** to `features/map/model/`. No `ol/*` import appears in `features/admin-editing/*`, in any presenter, in any `*.view.tsx`, or in `packages/shared`.
  4. **The API contract is DB-columns + EPSG:4326.** All translation (ISO→DB attribute names is unnecessary here because the form is DB-keyed; 3857→4326 geometry) happens on the frontend before the request.
- **API contracts (verified in code):**
  - `GET /api/layers` → `{ layers: Array<{ key: string; geomType: 'Point'|'MultiLineString'|'MultiPolygon'; attributes: string[] }> }`. `attributes` are **DB column names** (e.g. `dams` → `["name","name_en","wattage_mw","annual_output","year_launched","year_operational","status"]`). This route is public (no auth needed to list).
  - `POST /api/layers/:key/features` (admin-only) accepts `{ geometry, properties }`: `geometry` is a **GeoJSON geometry object in EPSG:4326**; `properties` is `{ db_column: value }`. The API **accepts single `LineString`/`Polygon` and `ST_Multi`-wraps** them for Multi layers (see `geometry.ts` `ALLOWED`), so the frontend may emit single geometries. Success → **201** `{ feature: {...} }`. Errors: 400 `VALIDATION_ERROR` (with `details`), 422 `GEOMETRY_ERROR`, 401/403 handled by `apiClient`.
- **MVP layering rules (design §7):** (1) `*.view.tsx` imports no `apiClient`/session-api/`ol/*`/`features/map/model` — props only; (2) presenters return a view-model + handlers, no JSX/fetch/`ol/*`; (3) only Models touch `apiClient` (`features.api.ts`) and OpenLayers (`features/map/model`); (4) `index.tsx` is wiring + the `RequireRole` gate only, with the "backend enforces; this is UX" comment; (5) the layer picker is sourced only from the editable-layer catalog.
- **TS constraints:** `verbatimModuleSyntax` (use `import type` for type-only imports), `erasableSyntaxOnly` (no TS enums, no constructor parameter-properties — use `type` unions + plain assignments), `noUnusedLocals`/`noUnusedParameters`, `jsx: react-jsx`.
- **Test/data hygiene:** no automated test hits the real API/GeoServer (all mock `fetch`/context). The manual `/run` uses features named with the `@webatlas.test` sentinel and deletes the test row afterward.

## Directory layout (end state — new/changed files)

```
packages/shared/src/
  layer-attributes.ts            # (modify) add denormalizeFeatureProperties
  layer-attributes.test.ts       # (modify) add round-trip test
  # dist/* regenerated via npm run build:shared

apps/web/src/
  features/map/model/
    geo.ts                       # (create) OL geometry helpers: olGeometryTo4326GeoJSON, geoJSON4326ToOlGeometry
    geo.test.ts                  # (create)
    DrawController.ts            # (create) owns OL Draw interaction + temp edit layer
    DrawController.test.ts       # (create)
    MapModel.ts                  # (modify) add refreshLayer(layerStateId)
  features/map/model/mapEditing.tsx   # (create) MapEditingProvider + useMapEditing() bridge (non-OL API)
  features/map/model/mapEditing.test.tsx  # (create)
  entities/layer/layersCatalog.api.ts # (create) fetchLayerCatalog() via apiRequest
  entities/layer/useLayerCatalog.ts   # (create) TanStack useQuery wrapper
  features/admin-editing/
    api/features.api.ts          # (create) createFeature(key, payload)
    api/features.api.test.ts     # (create)
    model/useEditToolbarPresenter.ts   # (create)
    model/useEditToolbarPresenter.test.ts
    model/useAttributeFormPresenter.ts # (create)
    model/useAttributeFormPresenter.test.ts
    ui/LayerPicker.view.tsx      # (create)
    ui/LayerPicker.view.test.tsx
    ui/DrawControls.view.tsx     # (create)
    ui/AttributeField.view.tsx   # (create)
    ui/AttributeForm.view.tsx    # (create)
    ui/AttributeForm.view.test.tsx
    ui/EditToolbar.view.tsx      # (create) passive toolbar shell
    index.tsx                    # (create) container: RequireRole('admin') + wiring
    index.test.tsx               # (create)
  app/providers/AppProviders.tsx # (modify) add MapEditingProvider inside MapProvider
  app/App.tsx                    # (modify) mount <AdminEditing /> in the admin slot
  styles/main.css                # (modify) toolbar/form styles
```

---

### Task 1: `denormalizeFeatureProperties` in `@webatlas/shared`

**Files:**
- Modify: `packages/shared/src/layer-attributes.ts`
- Modify: `packages/shared/src/layer-attributes.test.ts`
- Regenerate: `packages/shared/dist/*` (via `npm run build:shared`)

**Interfaces:**
- Consumes: `LAYER_ATTRIBUTE_MAP`, `EditableLayerKey` (existing).
- Produces: `denormalizeFeatureProperties(layerKey: EditableLayerKey, isoProps: Record<string, unknown>): Record<string, unknown>` — the inverse of `normalizeFeatureProperties`: ISO name → DB column using `LAYER_ATTRIBUTE_MAP[layerKey].attributes`. Drops the `layerKey` discriminator; passes `id` and unknown keys through unchanged. Round-trip `denormalize(normalize(db))` returns the original DB props (minus any keys not in the map, which pass through both ways).

- [ ] **Step 1: Write the failing round-trip test**

Append to `packages/shared/src/layer-attributes.test.ts`:
```ts
import { denormalizeFeatureProperties } from './layer-attributes';

describe('denormalizeFeatureProperties', () => {
  it('renames ISO names back to DB columns and drops layerKey', () => {
    const out = denormalizeFeatureProperties('dams', {
      layerKey: 'dams', geographicalName: 'Hoa Binh', ratedPower: 1920, commissioningYear: '1994',
    });
    expect(out.name).toBe('Hoa Binh');
    expect(out.wattage_mw).toBe(1920);
    expect(out.year_operational).toBe('1994');
    expect('layerKey' in out).toBe(false);
    // ISO names are not leaked
    expect('geographicalName' in out).toBe(false);
  });

  it('round-trips normalize -> denormalize for every editable layer', () => {
    const samples: Record<string, Record<string, unknown>> = {
      dams: { name: 'A', wattage_mw: 10, status: 'active' },
      rivers: { name: 'R', code: 'LA08', stream_order: 3 },
      stations: { name: 'S', station_type: 't', value: '1.2' },
      flood_zones: { name: 'F', hazard_type: 'h', risk_level: 'high' },
      drought_points: { name: 'D', risk_level: 'low', survey_date: '2024-01-01' },
      saltwater_intrusion: { name: 'Salt', salinity: '2', risk_level: 'med' },
      flood_generation: { name: 'FG', risk_level: 'high', flow_rate: 'fast' },
    };
    for (const key of EDITABLE_LAYER_KEYS) {
      const db = samples[key];
      const iso = normalizeFeatureProperties(key, db);
      const back = denormalizeFeatureProperties(key, iso as Record<string, unknown>);
      expect(back).toEqual(db);
    }
  });

  it('passes id and unknown keys through unchanged', () => {
    const out = denormalizeFeatureProperties('rivers', { id: 'uuid-9', hydroId: 'LA08', foo: 'bar' });
    expect(out.id).toBe('uuid-9');
    expect(out.code).toBe('LA08');
    expect(out.foo).toBe('bar');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/shared -- layer-attributes.test.ts`
Expected: FAIL — `denormalizeFeatureProperties` is not exported.

- [ ] **Step 3: Implement `denormalizeFeatureProperties`**

Append to `packages/shared/src/layer-attributes.ts` (after `normalizeFeatureProperties`):
```ts
/**
 * Inverse of `normalizeFeatureProperties`: rename ISO/INSPIRE property names back
 * to their DB columns for a given layer.
 * - `id` (uuid) passes through unchanged.
 * - The `layerKey` discriminator is dropped.
 * - Unknown keys pass through unchanged.
 * A round-trip `denormalize(normalize(db))` returns the original DB props.
 */
export function denormalizeFeatureProperties(
  layerKey: EditableLayerKey,
  isoProps: Record<string, unknown>
): Record<string, unknown> {
  const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
  const inverse: Record<string, string> = {};
  for (const [dbCol, isoName] of Object.entries(map)) inverse[isoName] = dbCol;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(isoProps)) {
    if (k === 'layerKey') continue;
    if (k === 'id') out.id = v;
    else if (inverse[k]) out[inverse[k]] = v;
    else out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/shared -- layer-attributes.test.ts`
Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Rebuild shared dist**

Run: `npm run build:shared`
Expected: `packages/shared/dist/layer-attributes.js` and `.d.ts` now export `denormalizeFeatureProperties`. (Consumers import from `dist`, so this step is mandatory.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/layer-attributes.ts packages/shared/src/layer-attributes.test.ts packages/shared/dist
git commit -m "feat(shared): denormalizeFeatureProperties (ISO->DB column, inverse of normalize)"
```

---

### Task 2: `geo.ts` — OL geometry helpers (in the OL quarantine)

**Files:**
- Create: `apps/web/src/features/map/model/geo.ts`
- Create: `apps/web/src/features/map/model/geo.test.ts`

**Interfaces:**
- Consumes: `ol/proj`, `ol/format/GeoJSON`, `ol/geom/Geometry` (types).
- Produces:
  - `olGeometryTo4326GeoJSON(geom: Geometry): GeoJSONGeometry` — clones the geometry, transforms **EPSG:3857 → EPSG:4326**, returns a plain GeoJSON geometry object (`{ type, coordinates }`).
  - `geoJSON4326ToOlGeometry(geojson: GeoJSONGeometry): Geometry` — parses a 4326 GeoJSON geometry and transforms **4326 → 3857** to an OL `Geometry` (for Plan 8; tested now).
  - `type GeoJSONGeometry = { type: string; coordinates: unknown }` (exported).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/geo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { olGeometryTo4326GeoJSON, geoJSON4326ToOlGeometry } from './geo';

describe('geo helpers', () => {
  it('converts an OL Point (3857) to a 4326 GeoJSON geometry', () => {
    const geom = new Point(fromLonLat([108.2, 13.5])); // 3857 meters
    const gj = olGeometryTo4326GeoJSON(geom);
    expect(gj.type).toBe('Point');
    const [lon, lat] = gj.coordinates as [number, number];
    expect(lon).toBeCloseTo(108.2, 4);
    expect(lat).toBeCloseTo(13.5, 4);
  });

  it('does not mutate the source geometry (works on a clone)', () => {
    const geom = new Point(fromLonLat([108.2, 13.5]));
    const before = geom.getCoordinates().slice();
    olGeometryTo4326GeoJSON(geom);
    expect(geom.getCoordinates()).toEqual(before);
  });

  it('round-trips 4326 GeoJSON -> OL (3857) -> 4326 GeoJSON', () => {
    const gj = { type: 'Point', coordinates: [108.2, 13.5] };
    const ol = geoJSON4326ToOlGeometry(gj);
    const back = olGeometryTo4326GeoJSON(ol);
    const [lon, lat] = back.coordinates as [number, number];
    expect(lon).toBeCloseTo(108.2, 4);
    expect(lat).toBeCloseTo(13.5, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/geo.test.ts`
Expected: FAIL — cannot find module `./geo`.

- [ ] **Step 3: Implement `geo.ts`**

Create `apps/web/src/features/map/model/geo.ts`:
```ts
import GeoJSON from 'ol/format/GeoJSON';
import type Geometry from 'ol/geom/Geometry';

export interface GeoJSONGeometry {
  type: string;
  coordinates: unknown;
}

const MAP_PROJECTION = 'EPSG:3857';
const DATA_PROJECTION = 'EPSG:4326';
const format = new GeoJSON();

/**
 * Convert an OpenLayers geometry (in the map projection, EPSG:3857) to a plain
 * GeoJSON geometry object in EPSG:4326. Works on a clone — the source is untouched.
 */
export function olGeometryTo4326GeoJSON(geom: Geometry): GeoJSONGeometry {
  return format.writeGeometryObject(geom, {
    dataProjection: DATA_PROJECTION,
    featureProjection: MAP_PROJECTION,
  }) as unknown as GeoJSONGeometry;
}

/**
 * Parse a GeoJSON geometry (EPSG:4326) into an OpenLayers geometry in the map
 * projection (EPSG:3857). Used by the modify/move plan; tested here.
 */
export function geoJSON4326ToOlGeometry(geojson: GeoJSONGeometry): Geometry {
  return format.readGeometry(geojson, {
    dataProjection: DATA_PROJECTION,
    featureProjection: MAP_PROJECTION,
  });
}
```
Note: `writeGeometryObject` with `featureProjection` set already transforms without mutating the input, so no manual clone is needed — the "does not mutate" test verifies this.

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/geo.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/geo.ts apps/web/src/features/map/model/geo.test.ts
git commit -m "feat(web): geo.ts OL geometry helpers (3857<->4326, OL<->GeoJSON) in the OL quarantine"
```

---

### Task 3: `MapModel.refreshLayer` — refetch a WFS source

**Files:**
- Modify: `apps/web/src/features/map/model/MapModel.ts`

**Interfaces:**
- Produces (on `MapModel`): `refreshLayer(layerStateId: string): void` — looks up `this.layers[layerStateId]`, and if present calls `source.refresh()` on its `VectorSource`, forcing a WFS re-request so a newly saved feature loads. No-op if the id is unknown or the map is not initialized.

- [ ] **Step 1: Add the method**

In `apps/web/src/features/map/model/MapModel.ts`, add a public method after `setReservoirFilter(...)` (before `dispose()`):
```ts
  /**
   * Force a WFS refetch for a thematic layer by its layersState id (e.g. 'layer_dams').
   * Called after an admin create/edit so the new feature renders live (design §4.7).
   */
  refreshLayer(layerStateId: string): void {
    if (!this.map) return;
    const layer = this.layers[layerStateId];
    if (!layer) return;
    layer.getSource()?.refresh();
  }
```

- [ ] **Step 2: Build to type-check**

Run: `npm run build:web`
Expected: compiles with no type errors (`getSource()` on `VectorLayer<VectorSource>` returns `VectorSource | null`; `refresh()` exists on `VectorSource`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/map/model/MapModel.ts
git commit -m "feat(web): MapModel.refreshLayer(layerStateId) to refetch a WFS source after a write"
```

---

### Task 4: `DrawController` — OL Draw interaction + temp edit layer

**Files:**
- Create: `apps/web/src/features/map/model/DrawController.ts`
- Create: `apps/web/src/features/map/model/DrawController.test.ts`

**Interfaces:**
- Consumes: `ol/Map`, `ol/interaction/Draw`, `ol/layer/Vector`, `ol/source/Vector`, `olGeometryTo4326GeoJSON` + `GeoJSONGeometry` (Task 2). `OgcGeometryType` from `@webatlas/shared`.
- Produces:
  - `class DrawController` constructed with the shared `Map`: `new DrawController(map: Map)`.
  - `startDraw(geomType: OgcGeometryType, onFinish: (geometry: GeoJSONGeometry) => void): void` — adds a temp `VectorLayer`/`VectorSource` (once) and an OL `Draw` interaction whose OL type is derived from `geomType` (`Point`→`Point`, `MultiLineString`→`LineString`, `MultiPolygon`→`Polygon`). On `drawend`, reads the sketch geometry, converts via `olGeometryTo4326GeoJSON`, calls `onFinish`, then removes the `Draw` interaction (draw is one-shot). Calling `startDraw` again first cancels any in-progress draw.
  - `cancel(): void` — removes the `Draw` interaction and clears the temp source; idempotent.
  - `dispose(): void` — `cancel()` + removes the temp layer from the map.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/DrawController.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Map from 'ol/Map';
import View from 'ol/View';
import Draw from 'ol/interaction/Draw';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import { fromLonLat } from 'ol/proj';
import { DrawController } from './DrawController';

function makeMap(): Map {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  return new Map({ target: el, view: new View({ center: fromLonLat([108, 13]), zoom: 7 }) });
}

function drawInteractions(map: Map): Draw[] {
  return map.getInteractions().getArray().filter((i): i is Draw => i instanceof Draw);
}

describe('DrawController', () => {
  let map: Map;
  let ctrl: DrawController;

  beforeEach(() => { map = makeMap(); ctrl = new DrawController(map); });
  afterEach(() => { ctrl.dispose(); map.setTarget(undefined); });

  it('adds a Draw interaction for the layer geometry type', () => {
    ctrl.startDraw('Point', () => {});
    const draws = drawInteractions(map);
    expect(draws).toHaveLength(1);
  });

  it('maps MultiPolygon to a Polygon draw and MultiLineString to a LineString draw', () => {
    ctrl.startDraw('MultiPolygon', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
    ctrl.cancel();
    ctrl.startDraw('MultiLineString', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
  });

  it('on drawend converts to 4326 GeoJSON and calls onFinish, then removes the interaction', () => {
    const onFinish = vi.fn();
    ctrl.startDraw('Point', onFinish);
    const draw = drawInteractions(map)[0];
    const feature = new Feature(new Point(fromLonLat([108.2, 13.5])));
    draw.dispatchEvent({ type: 'drawend', feature } as never);
    expect(onFinish).toHaveBeenCalledTimes(1);
    const gj = onFinish.mock.calls[0][0];
    expect(gj.type).toBe('Point');
    expect(gj.coordinates[0]).toBeCloseTo(108.2, 3);
    expect(gj.coordinates[1]).toBeCloseTo(13.5, 3);
    // one-shot: interaction removed after finish
    expect(drawInteractions(map)).toHaveLength(0);
  });

  it('cancel removes the interaction', () => {
    ctrl.startDraw('Point', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
    ctrl.cancel();
    expect(drawInteractions(map)).toHaveLength(0);
  });

  it('starting a new draw cancels the previous one (no interaction leak)', () => {
    ctrl.startDraw('Point', () => {});
    ctrl.startDraw('Point', () => {});
    expect(drawInteractions(map)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/DrawController.test.ts`
Expected: FAIL — cannot find module `./DrawController`.

- [ ] **Step 3: Implement `DrawController`**

Create `apps/web/src/features/map/model/DrawController.ts`:
```ts
import type Map from 'ol/Map';
import Draw from 'ol/interaction/Draw';
import type { DrawEvent } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { Type as OlGeometryType } from 'ol/geom/Geometry';
import type { OgcGeometryType } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

// Layer geometry type -> the single OL draw type. The API ST_Multi-wraps single
// LineString/Polygon into the Multi column, so drawing the single type is correct.
const DRAW_TYPE: Record<OgcGeometryType, OlGeometryType> = {
  Point: 'Point',
  MultiLineString: 'LineString',
  MultiPolygon: 'Polygon',
};

export class DrawController {
  private map: Map;
  private tempSource: VectorSource | null = null;
  private tempLayer: VectorLayer<VectorSource> | null = null;
  private draw: Draw | null = null;

  constructor(map: Map) {
    this.map = map;
  }

  private ensureTempLayer(): VectorSource {
    if (!this.tempSource) {
      this.tempSource = new VectorSource();
      this.tempLayer = new VectorLayer({ source: this.tempSource, properties: { id: '__edit_temp__' } });
      this.map.addLayer(this.tempLayer);
    }
    return this.tempSource;
  }

  startDraw(geomType: OgcGeometryType, onFinish: (geometry: GeoJSONGeometry) => void): void {
    this.cancel();
    const source = this.ensureTempLayer();
    const draw = new Draw({ source, type: DRAW_TYPE[geomType] });
    draw.on('drawend', (evt: DrawEvent) => {
      const geom = evt.feature.getGeometry();
      if (geom) onFinish(olGeometryTo4326GeoJSON(geom));
      // One-shot: end this draw so the sketch stays put until save/cancel.
      this.removeInteraction();
    });
    this.map.addInteraction(draw);
    this.draw = draw;
  }

  private removeInteraction(): void {
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw = null;
    }
  }

  cancel(): void {
    this.removeInteraction();
    this.tempSource?.clear();
  }

  dispose(): void {
    this.cancel();
    if (this.tempLayer) {
      this.map.removeLayer(this.tempLayer);
      this.tempLayer = null;
      this.tempSource = null;
    }
  }
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/DrawController.test.ts`
Expected: 5 tests pass. (If `DrawEvent`/`Type` type imports fail under `verbatimModuleSyntax`, they are `import type` — keep them so.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/DrawController.ts apps/web/src/features/map/model/DrawController.test.ts
git commit -m "feat(web): DrawController - OL Draw interaction + temp edit layer, emits 4326 GeoJSON"
```

---

### Task 5: `MapEditing` bridge — non-OL provider/hook over MapModel + DrawController

**Files:**
- Create: `apps/web/src/features/map/model/mapEditing.tsx`
- Create: `apps/web/src/features/map/model/mapEditing.test.tsx`

**Interfaces:**
- Consumes: `useMapContext` (existing `MapProvider`, gives the shared `ol/Map`), `DrawController` (Task 4), `MapModel.refreshLayer` — but the bridge does **not** re-expose any `ol/*` type to consumers. It reads the `Map` from context and holds a `DrawController` in a ref. It also needs `refreshLayer`; since the `MapModel` instance is owned by `MapView`, expose refresh through the same context by having the bridge keep a reference to the map and call a `MapModel`. To avoid plumbing the `MapModel` instance, the bridge instead constructs its own `DrawController(map)` and calls a passed `refreshLayer`. **Decision:** extend `MapProvider` context minimally is out of scope; instead the bridge takes the shared map and a `refreshLayer` callback wired in Task 9 via `MapView`. To keep Task 5 self-contained and testable, the bridge exposes a `registerRefresh(fn)` setter that `MapView` calls with `model.refreshLayer.bind(model)`.
- Produces:
  - `type GeoJSONGeometry` re-exported for presenter typing (plain object; no OL).
  - `MapEditingProvider({ children })` — React provider; on first render with a non-null map, lazily creates a `DrawController`.
  - `useMapEditing(): { hasMap: boolean; startDraw(geomType, onFinish): void; cancelDraw(): void; refreshLayer(layerStateId): void; registerRefresh(fn: (id: string) => void): void }` where `geomType: OgcGeometryType` and `onFinish: (g: GeoJSONGeometry) => void`. All parameters/returns are plain — **no `ol/*` leaks to consumers.**

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/mapEditing.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock the OL DrawController so this bridge test needs no real map.
const startDraw = vi.fn();
const cancel = vi.fn();
const dispose = vi.fn();
vi.mock('./DrawController', () => ({
  DrawController: vi.fn().mockImplementation(() => ({ startDraw, cancel, dispose })),
}));

// Mock the map context to supply a fake non-null map.
const fakeMap = {} as unknown;
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: fakeMap }),
}));

import { MapEditingProvider, useMapEditing } from './mapEditing';

const wrapper = ({ children }: { children: ReactNode }) => <MapEditingProvider>{children}</MapEditingProvider>;

describe('useMapEditing', () => {
  beforeEach(() => { startDraw.mockReset(); cancel.mockReset(); });

  it('reports hasMap true when a map is present', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    expect(result.current.hasMap).toBe(true);
  });

  it('delegates startDraw and cancelDraw to the DrawController', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const onFinish = vi.fn();
    act(() => result.current.startDraw('Point', onFinish));
    expect(startDraw).toHaveBeenCalledWith('Point', onFinish);
    act(() => result.current.cancelDraw());
    expect(cancel).toHaveBeenCalled();
  });

  it('refreshLayer calls the registered refresh function', () => {
    const { result } = renderHook(() => useMapEditing(), { wrapper });
    const refresh = vi.fn();
    act(() => result.current.registerRefresh(refresh));
    act(() => result.current.refreshLayer('layer_dams'));
    expect(refresh).toHaveBeenCalledWith('layer_dams');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/mapEditing.test.tsx`
Expected: FAIL — cannot find module `./mapEditing`.

- [ ] **Step 3: Implement the bridge**

Create `apps/web/src/features/map/model/mapEditing.tsx`:
```tsx
import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import type { OgcGeometryType } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { DrawController } from './DrawController';
import type { GeoJSONGeometry } from './geo';

export type { GeoJSONGeometry };

interface MapEditingValue {
  hasMap: boolean;
  startDraw: (geomType: OgcGeometryType, onFinish: (g: GeoJSONGeometry) => void) => void;
  cancelDraw: () => void;
  refreshLayer: (layerStateId: string) => void;
  registerRefresh: (fn: (layerStateId: string) => void) => void;
}

const MapEditingContext = createContext<MapEditingValue | undefined>(undefined);

export function MapEditingProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext();
  const controllerRef = useRef<DrawController | null>(null);
  const refreshRef = useRef<((id: string) => void) | null>(null);
  const [hasMap, setHasMap] = useState(false);

  useEffect(() => {
    if (map && !controllerRef.current) {
      controllerRef.current = new DrawController(map);
      setHasMap(true);
    }
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [map]);

  const startDraw = useCallback((geomType: OgcGeometryType, onFinish: (g: GeoJSONGeometry) => void) => {
    controllerRef.current?.startDraw(geomType, onFinish);
  }, []);
  const cancelDraw = useCallback(() => { controllerRef.current?.cancel(); }, []);
  const refreshLayer = useCallback((id: string) => { refreshRef.current?.(id); }, []);
  const registerRefresh = useCallback((fn: (id: string) => void) => { refreshRef.current = fn; }, []);

  return (
    <MapEditingContext.Provider value={{ hasMap, startDraw, cancelDraw, refreshLayer, registerRefresh }}>
      {children}
    </MapEditingContext.Provider>
  );
}

export function useMapEditing(): MapEditingValue {
  const ctx = useContext(MapEditingContext);
  if (!ctx) throw new Error('useMapEditing must be used within a MapEditingProvider');
  return ctx;
}
```
Note on `hasMap` under the mock: the mocked `useMapContext` returns a non-null map on first render, so the effect sets `hasMap` true. Under StrictMode the effect is idempotent (guarded by `controllerRef.current`).

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/map/model/mapEditing.test.tsx`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/mapEditing.tsx apps/web/src/features/map/model/mapEditing.test.tsx
git commit -m "feat(web): MapEditing bridge (non-OL provider/hook over DrawController + refresh)"
```

---

### Task 6: Layer catalog — `fetchLayerCatalog` + `useLayerCatalog`

**Files:**
- Create: `apps/web/src/entities/layer/layersCatalog.api.ts`
- Create: `apps/web/src/entities/layer/layersCatalog.api.test.ts`
- Create: `apps/web/src/entities/layer/useLayerCatalog.ts`

**Interfaces:**
- Consumes: `apiRequest` (Plan 6), `useQuery` (`@tanstack/react-query`), `OgcGeometryType` (`@webatlas/shared`).
- Produces:
  - `interface LayerCatalogEntry { key: EditableLayerKey; geomType: OgcGeometryType; attributes: string[] }` — `attributes` are DB column names.
  - `fetchLayerCatalog(): Promise<LayerCatalogEntry[]>` — `GET /api/layers`, returns `body.layers`.
  - `useLayerCatalog(): { data: LayerCatalogEntry[] | undefined; isLoading: boolean; error: unknown }` — TanStack `useQuery({ queryKey: ['layers'], queryFn: fetchLayerCatalog })`.

- [ ] **Step 1: Write the failing api test**

Create `apps/web/src/entities/layer/layersCatalog.api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../shared/api/apiClient';
import { fetchLayerCatalog } from './layersCatalog.api';

describe('fetchLayerCatalog', () => {
  it('GETs /api/layers and returns the layers array', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      layers: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }],
    });
    const out = await fetchLayerCatalog();
    expect(apiRequest).toHaveBeenCalledWith('/api/layers');
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('dams');
    expect(out[0].geomType).toBe('Point');
    expect(out[0].attributes).toEqual(['name', 'status']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/entities/layer/layersCatalog.api.test.ts`
Expected: FAIL — cannot find module `./layersCatalog.api`.

- [ ] **Step 3: Implement the api + query hook**

Create `apps/web/src/entities/layer/layersCatalog.api.ts`:
```ts
import { apiRequest } from '../../shared/api/apiClient';
import type { EditableLayerKey, OgcGeometryType } from '@webatlas/shared';

export interface LayerCatalogEntry {
  key: EditableLayerKey;
  geomType: OgcGeometryType;
  attributes: string[]; // DB column names
}

export async function fetchLayerCatalog(): Promise<LayerCatalogEntry[]> {
  const body = await apiRequest<{ layers: LayerCatalogEntry[] }>('/api/layers');
  return body.layers;
}
```

Create `apps/web/src/entities/layer/useLayerCatalog.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { fetchLayerCatalog } from './layersCatalog.api';

export function useLayerCatalog() {
  return useQuery({ queryKey: ['layers'], queryFn: fetchLayerCatalog });
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/entities/layer/layersCatalog.api.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/entities/layer/layersCatalog.api.ts apps/web/src/entities/layer/layersCatalog.api.test.ts apps/web/src/entities/layer/useLayerCatalog.ts
git commit -m "feat(web): layer catalog api + useLayerCatalog query (GET /api/layers)"
```

---

### Task 7: `features.api.ts` — createFeature

**Files:**
- Create: `apps/web/src/features/admin-editing/api/features.api.ts`
- Create: `apps/web/src/features/admin-editing/api/features.api.test.ts`

**Interfaces:**
- Consumes: `apiRequest` (Plan 6), `GeoJSONGeometry` (Task 5 re-export, plain object).
- Produces:
  - `interface CreateFeaturePayload { geometry: GeoJSONGeometry; properties: Record<string, unknown> }`.
  - `createFeature(key: string, payload: CreateFeaturePayload): Promise<{ id: string }>` — `POST /api/layers/:key/features` with a JSON body; returns `{ id: body.feature.id }`. Throws the `apiClient`'s `ApiError` on non-2xx (caller maps it).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/admin-editing/api/features.api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../shared/api/apiClient';
import { createFeature } from './features.api';

describe('createFeature', () => {
  it('POSTs the geometry + properties and returns the new id', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ feature: { id: 'new-uuid' } });
    const payload = { geometry: { type: 'Point', coordinates: [108, 13] }, properties: { name: 'X' } };
    const out = await createFeature('dams', payload);
    expect(out).toEqual({ id: 'new-uuid' });
    const [path, init] = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe('/api/layers/dams/features');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/api/features.api.test.ts`
Expected: FAIL — cannot find module `./features.api`.

- [ ] **Step 3: Implement `features.api.ts`**

Create `apps/web/src/features/admin-editing/api/features.api.ts`:
```ts
import { apiRequest } from '../../../shared/api/apiClient';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

export interface CreateFeaturePayload {
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown>;
}

export async function createFeature(key: string, payload: CreateFeaturePayload): Promise<{ id: string }> {
  const body = await apiRequest<{ feature: { id: string } }>(`/api/layers/${key}/features`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: body.feature.id };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/api/features.api.test.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin-editing/api
git commit -m "feat(web): features.api createFeature (POST /api/layers/:key/features)"
```

---

### Task 8: Presenters — toolbar + attribute form

**Files:**
- Create: `apps/web/src/features/admin-editing/model/useEditToolbarPresenter.ts`
- Create: `apps/web/src/features/admin-editing/model/useEditToolbarPresenter.test.ts`
- Create: `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.ts`
- Create: `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.test.ts`

**Interfaces:**
- Consumes: `useLayerCatalog` (Task 6), `useMapEditing` (Task 5), `createFeature` + `CreateFeaturePayload` (Task 7), `LAYER_ATTRIBUTE_MAP` + `EditableLayerKey` + `OgcGeometryType` (`@webatlas/shared`), `ApiError` (Plan 6), `GeoJSONGeometry` (Task 5).
- Produces:
  - `type EditMode = 'idle' | 'drawing' | 'form'`.
  - `useEditToolbarPresenter()` → `{ layers; selectedKey; mode; pendingGeometry; selectableGeomType; error; selectLayer(key); startDrawing(); cancel(); onGeometryFinished(g); }`:
    - `layers: LayerCatalogEntry[]` from `useLayerCatalog` (empty array while loading).
    - `selectLayer(key)` sets `selectedKey`, resets mode to `idle`, clears geometry.
    - `startDrawing()` requires a `selectedKey` and `hasMap`; sets `mode='drawing'`, calls `useMapEditing().startDraw(geomType, onFinish)` with the selected layer's `geomType`; on finish sets `pendingGeometry` and `mode='form'`.
    - `cancel()` calls `useMapEditing().cancelDraw()`, resets to `idle`, clears geometry.
  - `useAttributeFormPresenter(args: { layerKey: EditableLayerKey; attributes: string[]; geometry: GeoJSONGeometry | null; onSaved: () => void })` → `{ values; labels; setField(col, v); canSave; saving; error; fieldErrors; submit(): Promise<void> }`:
    - `values: Record<string, string>` — DB-column-keyed, all fields start `''`.
    - `labels: Record<string, string>` — DB column → ISO label from `LAYER_ATTRIBUTE_MAP[layerKey].attributes` (falls back to the column name if unmapped).
    - `canSave` is true only when `geometry !== null` (attributes are all nullable server-side, so no field is required client-side).
    - `submit()` builds `properties` from non-empty `values` (empty strings omitted) and calls `createFeature(layerKey, { geometry, properties })`; on success calls `onSaved()`; on `ApiError` maps: 400 → set `fieldErrors` from `error.details` if present else `error` message; 422 → `error='Invalid geometry — please redraw'`; 409 → `error='A feature like this already exists'`; else `error=error.message`.

- [ ] **Step 1: Write the failing toolbar-presenter test**

Create `apps/web/src/features/admin-editing/model/useEditToolbarPresenter.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const startDraw = vi.fn();
const cancelDraw = vi.fn();
vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ hasMap: true, startDraw, cancelDraw, refreshLayer: vi.fn(), registerRefresh: vi.fn() }),
}));
vi.mock('../../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({
    data: [
      { key: 'dams', geomType: 'Point', attributes: ['name', 'status'] },
      { key: 'rivers', geomType: 'MultiLineString', attributes: ['name', 'code'] },
    ],
    isLoading: false,
  }),
}));
import { useEditToolbarPresenter } from './useEditToolbarPresenter';

describe('useEditToolbarPresenter', () => {
  beforeEach(() => { startDraw.mockReset(); cancelDraw.mockReset(); });

  it('lists layers and starts idle with nothing selected', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    expect(result.current.layers.map((l) => l.key)).toEqual(['dams', 'rivers']);
    expect(result.current.mode).toBe('idle');
    expect(result.current.selectedKey).toBeNull();
  });

  it('selecting a layer then drawing calls startDraw with that geomType', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    act(() => result.current.selectLayer('rivers'));
    expect(result.current.selectedKey).toBe('rivers');
    act(() => result.current.startDrawing());
    expect(result.current.mode).toBe('drawing');
    expect(startDraw).toHaveBeenCalledWith('MultiLineString', expect.any(Function));
  });

  it('onGeometryFinished sets pendingGeometry and switches to form mode', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    act(() => result.current.selectLayer('dams'));
    act(() => result.current.startDrawing());
    const onFinish = startDraw.mock.calls[0][1];
    const geom = { type: 'Point', coordinates: [108, 13] };
    act(() => onFinish(geom));
    expect(result.current.pendingGeometry).toEqual(geom);
    expect(result.current.mode).toBe('form');
  });

  it('cancel resets to idle and clears geometry', () => {
    const { result } = renderHook(() => useEditToolbarPresenter());
    act(() => result.current.selectLayer('dams'));
    act(() => result.current.startDrawing());
    act(() => result.current.cancel());
    expect(cancelDraw).toHaveBeenCalled();
    expect(result.current.mode).toBe('idle');
    expect(result.current.pendingGeometry).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useEditToolbarPresenter.test.ts`
Expected: FAIL — cannot find module `./useEditToolbarPresenter`.

- [ ] **Step 3: Implement the toolbar presenter**

Create `apps/web/src/features/admin-editing/model/useEditToolbarPresenter.ts`:
```ts
import { useState, useCallback } from 'react';
import type { EditableLayerKey, OgcGeometryType } from '@webatlas/shared';
import { useMapEditing, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { useLayerCatalog, type LayerCatalogEntry } from '../../../entities/layer/useLayerCatalog';

export type EditMode = 'idle' | 'drawing' | 'form';

export function useEditToolbarPresenter() {
  const { hasMap, startDraw, cancelDraw } = useMapEditing();
  const catalog = useLayerCatalog();
  const layers: LayerCatalogEntry[] = catalog.data ?? [];

  const [selectedKey, setSelectedKey] = useState<EditableLayerKey | null>(null);
  const [mode, setMode] = useState<EditMode>('idle');
  const [pendingGeometry, setPendingGeometry] = useState<GeoJSONGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = layers.find((l) => l.key === selectedKey) ?? null;
  const selectableGeomType: OgcGeometryType | null = selected?.geomType ?? null;

  const selectLayer = useCallback((key: EditableLayerKey) => {
    setSelectedKey(key);
    setMode('idle');
    setPendingGeometry(null);
    setError(null);
  }, []);

  const onGeometryFinished = useCallback((g: GeoJSONGeometry) => {
    setPendingGeometry(g);
    setMode('form');
  }, []);

  const startDrawing = useCallback(() => {
    if (!selected || !hasMap) { setError('Select a layer first'); return; }
    setError(null);
    setPendingGeometry(null);
    setMode('drawing');
    startDraw(selected.geomType, onGeometryFinished);
  }, [selected, hasMap, startDraw, onGeometryFinished]);

  const cancel = useCallback(() => {
    cancelDraw();
    setMode('idle');
    setPendingGeometry(null);
    setError(null);
  }, [cancelDraw]);

  return {
    layers, selectedKey, mode, pendingGeometry, selectableGeomType, error,
    selectLayer, startDrawing, cancel, onGeometryFinished,
  };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useEditToolbarPresenter.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Write the failing attribute-form-presenter test**

Create `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const createFeature = vi.fn();
vi.mock('../api/features.api', () => ({ createFeature: (...a: unknown[]) => createFeature(...a) }));
import { ApiError } from '../../../shared/api/apiClient';
import { useAttributeFormPresenter } from './useAttributeFormPresenter';

const baseArgs = {
  layerKey: 'dams' as const,
  attributes: ['name', 'status'],
  geometry: { type: 'Point', coordinates: [108, 13] },
  onSaved: vi.fn(),
};

describe('useAttributeFormPresenter', () => {
  beforeEach(() => { createFeature.mockReset(); baseArgs.onSaved = vi.fn(); });

  it('exposes ISO labels for DB columns and empty initial values', () => {
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    expect(result.current.labels.name).toBe('geographicalName');
    expect(result.current.labels.status).toBe('operationalStatus');
    expect(result.current.values).toEqual({ name: '', status: '' });
  });

  it('canSave is false with no geometry, true with geometry', () => {
    const { result: no } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, geometry: null }));
    expect(no.current.canSave).toBe(false);
    const { result: yes } = renderHook(() => useAttributeFormPresenter(baseArgs));
    expect(yes.current.canSave).toBe(true);
  });

  it('submit posts non-empty DB-keyed properties + geometry and calls onSaved', async () => {
    createFeature.mockResolvedValue({ id: 'x' });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, onSaved }));
    act(() => { result.current.setField('name', 'Hoa Binh'); });
    await act(async () => { await result.current.submit(); });
    expect(createFeature).toHaveBeenCalledWith('dams', {
      geometry: baseArgs.geometry,
      properties: { name: 'Hoa Binh' }, // empty 'status' omitted
    });
    expect(onSaved).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('maps a 422 geometry error', async () => {
    createFeature.mockRejectedValue(new ApiError(422, 'GEOMETRY_ERROR', 'bad geom'));
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Invalid geometry — please redraw');
    expect(baseArgs.onSaved).not.toHaveBeenCalled();
  });

  it('maps a 400 validation error message', async () => {
    createFeature.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'name too long'));
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('name too long');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useAttributeFormPresenter.test.ts`
Expected: FAIL — cannot find module `./useAttributeFormPresenter`.

- [ ] **Step 7: Implement the attribute-form presenter**

Create `apps/web/src/features/admin-editing/model/useAttributeFormPresenter.ts`:
```ts
import { useState, useMemo, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { createFeature } from '../api/features.api';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

interface Args {
  layerKey: EditableLayerKey;
  attributes: string[]; // DB column names
  geometry: GeoJSONGeometry | null;
  onSaved: () => void;
}

function messageFor(e: ApiError): { error: string | null; fieldErrors: Record<string, string> } {
  if (e.status === 422) return { error: 'Invalid geometry — please redraw', fieldErrors: {} };
  if (e.status === 409) return { error: 'A feature like this already exists', fieldErrors: {} };
  if (e.status === 400) {
    const details = e.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(details as Record<string, unknown>)) fe[k] = String(v);
      if (Object.keys(fe).length > 0) return { error: null, fieldErrors: fe };
    }
    return { error: e.message, fieldErrors: {} };
  }
  return { error: e.message, fieldErrors: {} };
}

export function useAttributeFormPresenter({ layerKey, attributes, geometry, onSaved }: Args) {
  const labels = useMemo(() => {
    const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
    const out: Record<string, string> = {};
    for (const col of attributes) out[col] = map[col] ?? col;
    return out;
  }, [layerKey, attributes]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(attributes.map((c) => [c, '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canSave = geometry !== null && !saving;

  const setField = useCallback((col: string, v: string) => {
    setValues((prev) => ({ ...prev, [col]: v }));
  }, []);

  const submit = useCallback(async () => {
    if (!geometry) { setError('Draw a geometry first'); return; }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '') properties[k] = v;
    try {
      await createFeature(layerKey, { geometry, properties });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        const mapped = messageFor(e);
        setError(mapped.error);
        setFieldErrors(mapped.fieldErrors);
      } else {
        setError('Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  }, [geometry, values, layerKey, onSaved]);

  return { values, labels, setField, canSave, saving, error, fieldErrors, submit };
}
```

- [ ] **Step 8: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/model/useAttributeFormPresenter.test.ts`
Expected: 5 tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/admin-editing/model
git commit -m "feat(web): admin-editing presenters (toolbar draw flow + attribute form submit/error mapping)"
```

---

### Task 9: Views — LayerPicker, DrawControls, AttributeField, AttributeForm, EditToolbar

**Files:**
- Create: `apps/web/src/features/admin-editing/ui/LayerPicker.view.tsx`
- Create: `apps/web/src/features/admin-editing/ui/LayerPicker.view.test.tsx`
- Create: `apps/web/src/features/admin-editing/ui/DrawControls.view.tsx`
- Create: `apps/web/src/features/admin-editing/ui/AttributeField.view.tsx`
- Create: `apps/web/src/features/admin-editing/ui/AttributeForm.view.tsx`
- Create: `apps/web/src/features/admin-editing/ui/AttributeForm.view.test.tsx`
- Create: `apps/web/src/features/admin-editing/ui/EditToolbar.view.tsx`

**Interfaces:** all views are passive (props only; no `apiClient`/`ol/*`/`features/map/model`/session imports).
- `LayerPickerView({ layers, selectedKey, onSelect })` — `layers: { key: string; geomType: string }[]`; a labelled `<select>` listing exactly `layers`; calls `onSelect(key)`.
- `DrawControlsView({ geomType, mode, hasGeometry, onStartDraw, onCancel })` — a "Draw" button (disabled unless a layer is selected → caller passes `geomType` non-null) + hint text; a "Cancel" button when `mode !== 'idle'`.
- `AttributeFieldView({ column, label, value, error, onChange })` — one labelled text input (`label` shown, `column` in `htmlFor`/`id`); calls `onChange(value)`; shows `error` if present.
- `AttributeFormView({ attributes, labels, values, fieldErrors, error, canSave, saving, onField, onSubmit, onCancel })` — maps `attributes` to `AttributeFieldView`s; a submit button disabled unless `canSave`; a form-level error; a cancel button.
- `EditToolbarView({ children })` — passive shell wrapper (`glass-panel`), holds title + children.

- [ ] **Step 1: Write the failing LayerPicker test**

Create `apps/web/src/features/admin-editing/ui/LayerPicker.view.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerPickerView } from './LayerPicker.view';

const layers = [
  { key: 'dams', geomType: 'Point' },
  { key: 'rivers', geomType: 'MultiLineString' },
];

describe('LayerPickerView', () => {
  it('renders exactly the provided editable layers and no base layers', () => {
    render(<LayerPickerView layers={layers} selectedKey={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /rivers/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /provinces|wards/i })).not.toBeInTheDocument();
  });

  it('calls onSelect with the chosen key', async () => {
    const onSelect = vi.fn();
    render(<LayerPickerView layers={layers} selectedKey={null} onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'rivers');
    expect(onSelect).toHaveBeenCalledWith('rivers');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/ui/LayerPicker.view.test.tsx`
Expected: FAIL — cannot find module `./LayerPicker.view`.

- [ ] **Step 3: Implement LayerPicker + DrawControls + AttributeField views**

Create `apps/web/src/features/admin-editing/ui/LayerPicker.view.tsx`:
```tsx
export interface LayerPickerViewProps {
  layers: { key: string; geomType: string }[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

// Passive: the editable-layer selector. `layers` comes from the API catalog only.
export function LayerPickerView({ layers, selectedKey, onSelect }: LayerPickerViewProps) {
  return (
    <div className="edit-layer-picker">
      <label htmlFor="edit-layer-select">Layer</label>
      <select
        id="edit-layer-select"
        value={selectedKey ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>Select a layer…</option>
        {layers.map((l) => (
          <option key={l.key} value={l.key}>{l.key} ({l.geomType})</option>
        ))}
      </select>
    </div>
  );
}
```

Create `apps/web/src/features/admin-editing/ui/DrawControls.view.tsx`:
```tsx
export interface DrawControlsViewProps {
  geomType: string | null;
  mode: 'idle' | 'drawing' | 'form';
  onStartDraw: () => void;
  onCancel: () => void;
}

// Passive: draw / cancel controls + hint text.
export function DrawControlsView({ geomType, mode, onStartDraw, onCancel }: DrawControlsViewProps) {
  return (
    <div className="edit-draw-controls">
      <button type="button" onClick={onStartDraw} disabled={!geomType || mode !== 'idle'}>
        {mode === 'drawing' ? 'Drawing…' : 'Draw'}
      </button>
      {mode !== 'idle' && (
        <button type="button" onClick={onCancel}>Cancel</button>
      )}
      {geomType && mode === 'idle' && <p className="edit-hint">Click Draw, then place a {geomType} on the map.</p>}
      {mode === 'drawing' && <p className="edit-hint">Draw the {geomType} on the map to continue.</p>}
    </div>
  );
}
```

Create `apps/web/src/features/admin-editing/ui/AttributeField.view.tsx`:
```tsx
export interface AttributeFieldViewProps {
  column: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}

// Passive: one attribute field — ISO label + text input, reused per attribute.
export function AttributeFieldView({ column, label, value, error, onChange }: AttributeFieldViewProps) {
  const id = `attr-${column}`;
  return (
    <div className="edit-attr-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="edit-attr-error" role="alert">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Write the failing AttributeForm test**

Create `apps/web/src/features/admin-editing/ui/AttributeForm.view.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttributeFormView } from './AttributeForm.view';

const baseProps = {
  attributes: ['name', 'status'],
  labels: { name: 'geographicalName', status: 'operationalStatus' },
  values: { name: '', status: '' },
  fieldErrors: {} as Record<string, string>,
  error: null as string | null,
  canSave: true,
  saving: false,
  onField: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe('AttributeFormView', () => {
  it('renders one field per attribute with ISO labels', () => {
    render(<AttributeFormView {...baseProps} />);
    expect(screen.getByLabelText('geographicalName')).toBeInTheDocument();
    expect(screen.getByLabelText('operationalStatus')).toBeInTheDocument();
  });

  it('disables save when canSave is false', () => {
    render(<AttributeFormView {...baseProps} canSave={false} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onSubmit when the form is submitted', async () => {
    const onSubmit = vi.fn();
    render(<AttributeFormView {...baseProps} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('shows a form-level error', () => {
    render(<AttributeFormView {...baseProps} error="Invalid geometry — please redraw" />);
    expect(screen.getByText('Invalid geometry — please redraw')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/ui/AttributeForm.view.test.tsx`
Expected: FAIL — cannot find module `./AttributeForm.view`.

- [ ] **Step 6: Implement AttributeForm + EditToolbar views**

Create `apps/web/src/features/admin-editing/ui/AttributeForm.view.tsx`:
```tsx
import { AttributeFieldView } from './AttributeField.view';

export interface AttributeFormViewProps {
  attributes: string[];
  labels: Record<string, string>;
  values: Record<string, string>;
  fieldErrors: Record<string, string>;
  error: string | null;
  canSave: boolean;
  saving: boolean;
  onField: (column: string, v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Passive: maps a layer's attributes to a list of AttributeFieldView.
export function AttributeFormView(props: AttributeFormViewProps) {
  const { attributes, labels, values, fieldErrors, error, canSave, saving, onField, onSubmit, onCancel } = props;
  return (
    <form className="edit-attr-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {attributes.map((col) => (
        <AttributeFieldView
          key={col}
          column={col}
          label={labels[col] ?? col}
          value={values[col] ?? ''}
          error={fieldErrors[col]}
          onChange={(v) => onField(col, v)}
        />
      ))}
      {error && <p className="edit-form-error" role="alert">{error}</p>}
      <div className="edit-form-actions">
        <button type="submit" disabled={!canSave}>{saving ? 'Saving…' : 'Save feature'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
```

Create `apps/web/src/features/admin-editing/ui/EditToolbar.view.tsx`:
```tsx
import type { ReactNode } from 'react';

// Passive toolbar shell.
export function EditToolbarView({ children }: { children: ReactNode }) {
  return (
    <div className="edit-toolbar glass-panel">
      <h3 className="edit-toolbar-title">Add a feature</h3>
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Run tests → PASS**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/ui`
Expected: LayerPicker (2) + AttributeForm (4) pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/admin-editing/ui
git commit -m "feat(web): admin-editing views (LayerPicker, DrawControls, AttributeField/Form, EditToolbar shell)"
```

---

### Task 10: Container + provider wiring + app mount

**Files:**
- Create: `apps/web/src/features/admin-editing/index.tsx`
- Create: `apps/web/src/features/admin-editing/index.test.tsx`
- Modify: `apps/web/src/app/providers/AppProviders.tsx`
- Modify: `apps/web/src/features/map/ui/MapView.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `useEditToolbarPresenter` (Task 8), `useAttributeFormPresenter` (Task 8), the views (Task 9), `RequireRole` (Plan 6), `useMapEditing` (Task 5, for `refreshLayer` after save), `LAYER_ATTRIBUTE_MAP`/`EditableLayerKey`, `useLayerCatalog` (via toolbar presenter), `MapModel.refreshLayer` (registered in `MapView`).
- Produces:
  - `AdminEditing` (default export of `features/admin-editing/index.tsx`) — `RequireRole('admin')`-gated (UX comment). Renders `EditToolbarView` → `LayerPickerView` + `DrawControlsView`; when `mode === 'form'`, renders `AttributeFormView` fed by `useAttributeFormPresenter`. On save success: refetch the saved layer's WFS source via `useMapEditing().refreshLayer(layerStateId)`, invalidate the `['layers']` query is unnecessary (catalog is static), reset the toolbar to idle.
  - `AppProviders` updated: `MapEditingProvider` wraps children **inside** `MapProvider` (needs the map context) so both the map and the admin toolbar share one editing controller.
  - `MapView` updated: after `model.init`, call `registerRefresh(model.refreshLayer.bind(model))` from `useMapEditing()` so the bridge can refetch WFS.

- [ ] **Step 1: Wire the MapEditingProvider into AppProviders**

Edit `apps/web/src/app/providers/AppProviders.tsx` — import and nest the provider inside `MapProvider`:
```tsx
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../shared/api/queryClient';
import { AuthProvider } from '../../entities/session/model/session.store';
import { MapProvider } from './MapProvider';
import { MapEditingProvider } from '../../features/map/model/mapEditing';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MapProvider>
          <MapEditingProvider>{children}</MapEditingProvider>
        </MapProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Register the refresh function from MapView**

Edit `apps/web/src/features/map/ui/MapView.tsx` — pull `registerRefresh` from the editing bridge and register the model's `refreshLayer` after init:
```tsx
import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapEditing } from '../model/mapEditing';
import { MapModel } from '../model/MapModel';

const MapView: React.FC = () => {
  const el = useRef<HTMLDivElement>(null);
  const modelRef = useRef<MapModel | null>(null);
  const { setMap, basemap, layersState, reservoirFilter } = useMapContext();
  const { registerRefresh } = useMapEditing();

  useEffect(() => {
    if (!el.current) return;
    const model = new MapModel();
    model.init(el.current);
    modelRef.current = model;
    setMap(model.getMap());
    registerRefresh((id: string) => model.refreshLayer(id));
    return () => model.dispose();
  }, []);

  useEffect(() => { modelRef.current?.setBasemap(basemap); }, [basemap]);
  useEffect(() => { modelRef.current?.applyLayerStates(layersState); }, [layersState]);
  useEffect(() => { modelRef.current?.setReservoirFilter(reservoirFilter); }, [reservoirFilter]);

  return <div ref={el} className={`map-container basemap-${basemap}`} />;
};

export default MapView;
```
Note: `MapView` is inside `features/map`, so importing `useMapEditing` from `../model/mapEditing` is within the OL boundary and allowed.

- [ ] **Step 3: Implement the container**

Create `apps/web/src/features/admin-editing/index.tsx`:
```tsx
import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { RequireRole } from '../auth/ui/RequireRole';
import { useMapEditing } from '../map/model/mapEditing';
import { useEditToolbarPresenter } from './model/useEditToolbarPresenter';
import { useAttributeFormPresenter } from './model/useAttributeFormPresenter';
import { EditToolbarView } from './ui/EditToolbar.view';
import { LayerPickerView } from './ui/LayerPicker.view';
import { DrawControlsView } from './ui/DrawControls.view';
import { AttributeFormView } from './ui/AttributeForm.view';

function EditToolbar() {
  const toolbar = useEditToolbarPresenter();
  const { refreshLayer } = useMapEditing();
  const selected = toolbar.layers.find((l) => l.key === toolbar.selectedKey) ?? null;

  const form = useAttributeFormPresenter({
    layerKey: (toolbar.selectedKey ?? 'dams') as EditableLayerKey,
    attributes: selected?.attributes ?? [],
    geometry: toolbar.pendingGeometry,
    onSaved: () => {
      if (toolbar.selectedKey) {
        refreshLayer(LAYER_ATTRIBUTE_MAP[toolbar.selectedKey as EditableLayerKey].layerStateId);
      }
      toolbar.cancel();
    },
  });

  return (
    <EditToolbarView>
      <LayerPickerView
        layers={toolbar.layers.map((l) => ({ key: l.key, geomType: l.geomType }))}
        selectedKey={toolbar.selectedKey}
        onSelect={(k) => toolbar.selectLayer(k as EditableLayerKey)}
      />
      <DrawControlsView
        geomType={toolbar.selectableGeomType}
        mode={toolbar.mode}
        onStartDraw={toolbar.startDrawing}
        onCancel={toolbar.cancel}
      />
      {toolbar.mode === 'form' && selected && (
        <AttributeFormView
          attributes={selected.attributes}
          labels={form.labels}
          values={form.values}
          fieldErrors={form.fieldErrors}
          error={form.error}
          canSave={form.canSave}
          saving={form.saving}
          onField={form.setField}
          onSubmit={form.submit}
          onCancel={toolbar.cancel}
        />
      )}
    </EditToolbarView>
  );
}

// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// admin route); a user who forces this open still cannot perform admin API calls.
export default function AdminEditing() {
  return (
    <RequireRole role="admin">
      <EditToolbar />
    </RequireRole>
  );
}
```
Note: `useAttributeFormPresenter` is always called (Rules of Hooks) with `attributes: []` until a layer is selected; it only submits when `mode === 'form'` and the form view is mounted. The `layerKey` fallback `'dams'` is inert while `attributes` is empty (no fields render, save is gated by geometry).

- [ ] **Step 4: Write the failing container test**

Create `apps/web/src/features/admin-editing/index.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// admin session so RequireRole passes
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' }, status: 'authenticated', login: vi.fn(), logout: vi.fn() }),
}));
// map editing bridge stub
vi.mock('../map/model/mapEditing', () => ({
  useMapEditing: () => ({ hasMap: true, startDraw: vi.fn(), cancelDraw: vi.fn(), refreshLayer: vi.fn(), registerRefresh: vi.fn() }),
}));
// layer catalog stub
vi.mock('../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({ data: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }], isLoading: false }),
}));

import AdminEditing from './index';

describe('AdminEditing', () => {
  it('renders the toolbar with the layer picker and a draw control for an admin', () => {
    render(<AdminEditing />);
    expect(screen.getByText('Add a feature')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draw/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npm run test -w @webatlas/web -- src/features/admin-editing/index.test.tsx`
Expected: initially FAIL (module missing), PASS after Step 3. 1 test passes.

- [ ] **Step 6: Mount `AdminEditing` in App.tsx**

Edit `apps/web/src/app/App.tsx` — replace the Plan 6 admin placeholder (`RequireRole role="admin"` wrapping "Admin tools (coming soon)") with the real toolbar. Add the import:
```tsx
import AdminEditing from '../features/admin-editing';
```
Then in the `auth-widget-slot` block, replace:
```tsx
          <RequireRole role="admin">
            <div className="admin-region-placeholder glass-panel">Admin tools (coming soon)</div>
          </RequireRole>
```
with:
```tsx
          <AdminEditing />
```
(`AdminEditing` self-gates with `RequireRole('admin')`, so the outer `RequireRole` import in App.tsx may become unused — if so, remove that import to satisfy `noUnusedLocals`.)

- [ ] **Step 7: Toolbar/form styles**

Append to `apps/web/src/styles/main.css`:
```css
.edit-toolbar { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 10px; min-width: 260px; }
.edit-toolbar-title { margin: 0 0 2px; font-size: 14px; }
.edit-layer-picker, .edit-draw-controls, .edit-attr-form { display: flex; flex-direction: column; gap: 6px; }
.edit-draw-controls { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 8px; }
.edit-layer-picker select, .edit-attr-field input { padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.2); }
.edit-hint { margin: 0; font-size: 12px; opacity: 0.75; flex-basis: 100%; }
.edit-attr-field { display: flex; flex-direction: column; gap: 4px; }
.edit-attr-error, .edit-form-error { color: #c0392b; font-size: 12px; margin: 0; }
.edit-form-actions { display: flex; gap: 8px; margin-top: 4px; }
.edit-toolbar button { cursor: pointer; padding: 6px 10px; border-radius: 6px; border: none; }
```

- [ ] **Step 8: Build + lint + full web test suite**

Run (from repo root):
```bash
npm run build:web
npm run lint:web
npm run test -w @webatlas/web
```
Expected: web builds (tsc + vite) with no type errors; lint exit 0 (pre-existing warnings only); every web test file passes. Fix type errors before committing (watch `verbatimModuleSyntax` `import type`, unused imports in App.tsx).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/admin-editing/index.tsx apps/web/src/features/admin-editing/index.test.tsx apps/web/src/app/providers/AppProviders.tsx apps/web/src/features/map/ui/MapView.tsx apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): admin draw-to-create toolbar container + provider wiring + WFS refetch on save"
```

---

### Task 11: Convention guard (OL quarantine) — lint/grep check + manual verification

**Files:**
- (No new source.) A verification task: prove the OL quarantine and layering rules hold, and drive the flow end-to-end.

- [ ] **Step 1: Grep for OL-quarantine violations**

Run (from repo root) and confirm **zero** matches outside `apps/web/src/features/map/model/`:
```bash
git grep -n "from 'ol/" -- 'apps/web/src/features/admin-editing' 'apps/web/src/entities/layer' 'packages/shared/src' || echo "OK: no ol/* imports in admin-editing / entities/layer / shared"
```
Expected: prints `OK: ...` (no matches). Also confirm no `*.view.tsx` imports `apiClient` or `features/map/model`:
```bash
git grep -n "apiClient\|features/map/model" -- 'apps/web/src/features/admin-editing/ui/*.view.tsx' || echo "OK: views are props-only"
```
Expected: `OK: views are props-only`.

- [ ] **Step 2: Full suite (shared + web) green**

Run:
```bash
npm run test:shared
npm run test -w @webatlas/web
npm run build:web && npm run lint:web
```
Expected: all pass; build clean; lint exit 0.

- [ ] **Step 3: Manual `/run` — draw-to-create walkthrough**

Prereqs (separate terminals): API `npm run dev -w @webatlas/api`, web `npm run dev:web`, GeoServer up with the 7 layers published, an admin present (`npm run create-admin -w @webatlas/api -- --email admin@webatlas.test --password admin-pass-123`).
- Log in as the admin → the "Add a feature" toolbar appears (hidden when logged out or as a non-admin).
- Pick **dams** (Point). Click **Draw**, click once on the map → the attribute form opens.
- Fill `geographicalName` = `Test Dam @webatlas.test`. Click **Save feature**.
- Expect a 201; the dams WFS layer refetches and the new point renders live.
- Repeat with **rivers** (draw a LineString) and **flood_zones** (draw a Polygon) to confirm Multi-wrapping works.
- **Cleanup:** delete the test rows (the `@webatlas.test` sentinel) directly in the DB or via a later delete tool. Confirm no leftover test features.

- [ ] **Step 4: Commit (docs/verification note, if any)**

No code change expected in this task. If Step 1/2 surfaced a violation you fixed, commit that fix:
```bash
git add -A
git commit -m "chore(web): enforce OL quarantine / layering for admin-editing (Plan 7 verification)"
```

---

## Self-Review

**1. Spec coverage (design §1–§9):**
- Pick layer → draw → attribute form → save → live refetch (§1 milestone) → Tasks 6–10 ✓
- Only 7 editable layers; picker sourced from `GET /api/layers`; base layers excluded (§2 INV-1) → Tasks 6, 9 (LayerPicker test asserts no provinces/wards) ✓
- Backend authorization boundary; `RequireRole` UX-only with comment (§2 INV-2) → Task 10 (container comment) ✓
- OL quarantined to `features/map/model/`; `DrawController`/`geo.ts` live there; bridge exposes non-OL API (§2 INV-3, §3) → Tasks 2, 4, 5, 11 (grep guard) ✓
- API contract DB-columns + 4326; frontend translates (§2 INV-4) → Tasks 2 (geo), 7/8 (DB-keyed props) ✓
- `DrawController` interface (startDraw/cancel, temp layer, 3857→4326 GeoJSON on drawend) (§3.1) → Task 4 ✓
- `geo.ts` reproject + GeoJSON, kept out of shared (§3.2) → Task 2 ✓
- `denormalizeFeatureProperties` inverse + round-trip test (§3.3) → Task 1 ✓
- Data flow (temp source ephemeral 3857 → 4326 plain object → form → POST → 201 → cancel + refetch) (§4) → Tasks 4, 8, 10 ✓
- Error handling (400/422/409/401/403; save disabled until geometry) (§5) → Task 8 presenter mapping + Task 9 canSave ✓
- Testing: presenters (mocked bridge/api), views (props), DrawController (OL double), geo unit, denormalize round-trip, manual /run (§6) → Tasks 1–11 ✓
- Convention rules (§7) → Task 11 grep guard + layering enforced by imports throughout ✓

**2. Placeholder scan:** every step has concrete code/commands; no TBD/TODO. The `'dams'` fallback for `layerKey` in the container (Task 10) is a documented inert default (no fields render until a real layer is selected), not a placeholder.

**3. Type/name consistency:** `GeoJSONGeometry` (defined in `geo.ts` Task 2, re-exported from `mapEditing` Task 5, consumed in Tasks 7/8), `olGeometryTo4326GeoJSON`/`geoJSON4326ToOlGeometry` (Task 2 → Task 4), `DrawController.startDraw/cancel/dispose` (Task 4 → Task 5), `useMapEditing().{hasMap,startDraw,cancelDraw,refreshLayer,registerRefresh}` (Task 5 → Tasks 8/10), `MapModel.refreshLayer` (Task 3 → Task 10 MapView), `fetchLayerCatalog`/`useLayerCatalog`/`LayerCatalogEntry` (Task 6 → Task 8), `createFeature`/`CreateFeaturePayload` (Task 7 → Task 8), `denormalizeFeatureProperties` (Task 1; available for ISO-input paths), `LAYER_ATTRIBUTE_MAP[key].{attributes,layerStateId}` (used in Tasks 8/10 — verified present in `packages/shared/src/layer-attributes.ts`). `OgcGeometryType` values `Point|MultiLineString|MultiPolygon` verified against `layer-geometry.ts`. All consistent.

**4. Risks for the implementer:**
- **`@webatlas/shared` dist rebuild (Task 1 Step 5):** consumers import from `dist`; skipping the rebuild means `denormalizeFeatureProperties` is undefined at web runtime. Always run `npm run build:shared` and commit `dist/`.
- **OL types under `verbatimModuleSyntax`:** `DrawEvent`, `Type` (geom), `Geometry`, `Map` are type-only → `import type`. `Draw`, `VectorLayer`, `VectorSource`, `GeoJSON`, `Point` are values → normal import.
- **`DrawController` test in jsdom:** OL `Map` needs a target with sized client rect — the test stubs `clientWidth/Height`. Drawing is simulated via `draw.dispatchEvent({ type: 'drawend', feature })` rather than pointer events (no canvas rendering in jsdom).
- **Rules of Hooks in the container (Task 10):** `useAttributeFormPresenter` is called unconditionally with `attributes: []`/`geometry: null` until a layer + geometry exist; the form view only mounts in `mode === 'form'`. Do not move the hook behind a condition.
- **`refreshLayer` timing:** `registerRefresh` runs in `MapView`'s mount effect; the bridge's `refreshLayer` no-ops until then. Since the toolbar can only save after the map is drawn on, the refresh fn is always registered by save time.
- **StrictMode double-mount:** `MapEditingProvider` guards `DrawController` creation with `controllerRef.current`; `DrawController.ensureTempLayer` guards its temp layer; both idempotent.
- **Lint (`oxlint`):** unused `RequireRole` import in `App.tsx` after removing the placeholder — remove it. Unused vars anywhere fail the web build (`noUnusedLocals`).

---

## Follow-on

- **Next editing plan (modify/move + delete):** select an existing WFS feature → OL `Modify`/`Translate` (reusing `DrawController`/`geo.ts` + `geoJSON4326ToOlGeometry`) and/or edit attributes in this plan's form → `PUT /api/layers/:key/features/:id`; delete → `DELETE …`. Reuses `useAttributeFormPresenter` (seed `values` from the selected feature via `denormalizeFeatureProperties` on save) and the WFS refetch.
- **Editable labels plan:** `app.layer_attribute_labels` table + admin GET/PUT + runtime label fetch; the form swaps its label source from `LAYER_ATTRIBUTE_MAP` to the API with no change to the DB-keyed save path.
