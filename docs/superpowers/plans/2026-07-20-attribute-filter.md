# Attribute Filter Implementation Plan (Roadmap 2.3, first cut)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side attribute filter over all 7 thematic layers, available to every role, opened from a funnel button beside the top search bar; multiple AND-ed conditions typed by attribute produce a clickable fly-to result list (no map restyling).

**Architecture:** A shared `attribute-schema` descriptor (per-layer filterable fields + types, keyed by ISO/INSPIRE property names) feeds a new `features/attribute-filter/` FSD slice: a pure `applyFilter`, a `useFilterPresenter` that reads already-loaded OpenLayers features from `useMapContext().map`, and props-only views. The funnel button + panel mount inside the existing `SearchBar`.

**Tech Stack:** React 19 + TypeScript, `@webatlas/shared` (rebuilt), OpenLayers (read-only feature access + `getView().animate` for fly-to), Vitest + Testing Library, oxlint. No new dependency, no backend/GeoServer change.

**Design doc:** `docs/superpowers/specs/2026-07-20-attribute-filter-design.md`

## Global Constraints

- **Client-side only.** Filter operates on features already loaded in the OL vector sources. No `apiRequest`, no WFS `CQL_FILTER`, no new API endpoint (design §2).
- **Filter on ISO/INSPIRE property names**, not DB columns — features are normalized to ISO names in `wfsSource.ts` before they reach memory. The `dams` status field filters on the stamped **`statusSlug`**, not `operationalStatus` (which holds a display label) (design §3, §4.1).
- **Presenter returns a view-model + handlers** (no JSX, no fetch); `*.view.tsx` are **props-only** (no hooks/context/data access) — the established `features/*` discipline.
- **Everyone, no auth gate** — filtering has no write dimension on public WFS layers (design §2).
- **No map restyling** — a filter yields a list, never a change to how features are drawn (design §1, §9).
- **AND-only, one layer at a time, no saved filters** — YAGNI (design §9).
- **jsdom cannot prove reachability** — no layout engine; `getBoundingClientRect()` returns zeros, `elementFromPoint` is meaningless. NO unit test may assert overlap/z-index/clickability. Panel placement is verified only in the `/run` task (design §7).
- **Reuse `glass-panel`** + the existing `SearchBar` result-item styling and `flyTo` (`map.getView().animate({ center: fromLonLat(coords), zoom, duration })`) pattern. No new styling system.
- **Verified facts (checked against code):**
  - `EDITABLE_LAYER_KEYS = ['dams','rivers','stations','flood_zones','drought_points','saltwater_intrusion','flood_generation']`; `EditableLayerKey` is their union.
  - Each OL layer carries `properties: { id: <layerStateId> }`. Lookup: `map.getLayers().getArray().find(l => l.get('id') === layerStateId)`, then `layer.getSource().getFeatures()`.
  - `LAYER_ATTRIBUTE_MAP[key]` has `{ wfsTypeName, layerStateId, attributes: Record<dbCol, isoName> }`.
  - `useMapContext()` exposes `{ map: ol/Map | null, layersState, toggleLayerVisibility, ... }`.
  - Vietnamese layer display names (from `data/mockData`): dams `'Đập & Hồ chứa'`, rivers `'Mạng lưới sông ngòi'`, stations `'Trạm quan trắc'`, flood_zones `'Vùng ngập lụt'`, drought_points `'Vùng hạn hán'`, saltwater_intrusion `'Xâm nhập mặn'`, flood_generation `'Vùng sinh lũ'`.
- **Commands:** web tests `npm test -w @webatlas/web`; shared tests `npm test -w @webatlas/shared`; shared build `npm run build -w @webatlas/shared`; web build `npm run build -w @webatlas/web`; lint `npm run lint -w @webatlas/web`. `@webatlas/shared` must be rebuilt after Task 1 so the web workspace sees the new export.

---

### Task 1: Shared attribute schema — `packages/shared/src/attribute-schema.ts`

Per-layer filterable fields with UI type + Vietnamese label, keyed by ISO name.

**Files:**
- Create: `packages/shared/src/attribute-schema.ts`
- Create: `packages/shared/src/attribute-schema.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './attribute-schema';`)

**Interfaces:**
- Consumes: `EditableLayerKey` from `./index`.
- Produces: `FilterFieldType`, `FilterField`, `LAYER_FILTER_FIELDS`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/attribute-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_FILTER_FIELDS } from './attribute-schema';

describe('LAYER_FILTER_FIELDS', () => {
  it('has at least one filter field for every editable layer', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(LAYER_FILTER_FIELDS[key].length).toBeGreaterThan(0);
    }
  });

  it('every enum field lists its values', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      for (const f of LAYER_FILTER_FIELDS[key]) {
        if (f.type === 'enum') {
          expect(Array.isArray(f.enumValues)).toBe(true);
          expect(f.enumValues!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every field has an iso key, a label, and a valid type', () => {
    const types = ['enum', 'number', 'date', 'text'];
    for (const key of EDITABLE_LAYER_KEYS) {
      for (const f of LAYER_FILTER_FIELDS[key]) {
        expect(typeof f.iso).toBe('string');
        expect(f.iso.length).toBeGreaterThan(0);
        expect(typeof f.label).toBe('string');
        expect(types).toContain(f.type);
      }
    }
  });

  it('dams filters status on the stamped statusSlug, not the display label', () => {
    const statusField = LAYER_FILTER_FIELDS.dams.find((f) => f.type === 'enum' && f.iso === 'statusSlug');
    expect(statusField).toBeDefined();
    expect(statusField!.enumValues).toContain('xa_lu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/shared -- attribute-schema`
Expected: FAIL — cannot resolve `./attribute-schema`.

- [ ] **Step 3: Implement `attribute-schema.ts`**

Create `packages/shared/src/attribute-schema.ts`:

```ts
import type { EditableLayerKey } from './index';

export type FilterFieldType = 'enum' | 'number' | 'date' | 'text';

export interface FilterField {
  /** ISO/INSPIRE property name as stored on the in-memory feature. */
  iso: string;
  /** Vietnamese UI label. */
  label: string;
  type: FilterFieldType;
  /** For 'enum' — the allowed (canonical) values. */
  enumValues?: string[];
}

// Canonical dam status slugs (match wfsSource.ts stamping via toDamStatusSlug).
const DAM_STATUS_SLUGS = ['binh_thuong', 'xa_lu', 'nguy_hiem'] as const;
// Hazard riskLevel values — the seed data stores Vietnamese labels, NOT low/medium/high
// (verified against apps/api/src/db/seeds/data/*.geojson). Filter must match the real strings.
const RISK_LEVELS = ['Cao', 'Trung bình', 'Thấp'] as const;

// Filterable fields per layer, keyed by the ISO name on the feature.
// localId/geographicalNameEn and pure ids are omitted — not useful filters.
//
// IMPORTANT — type reflects the REAL data shape (verified against seed sources):
//   * dams wattage_mw (Wattage_PL) and rivers stream_order/length_m (Cap/Chieu_dai) are
//     genuine numbers -> 'number'.
//   * hazard `area`/`salinity` and station `value` are labeled STRINGS in the data
//     ("120 km2", "4.2 g/l", "Mực nước: 2.3m") -> 'text', NOT 'number'. A numeric >= on
//     "120 km2" would fail. They are still useful as text-contains filters.
//   * riskLevel is a Vietnamese enum ("Cao"/"Trung bình").
export const LAYER_FILTER_FIELDS: Record<EditableLayerKey, FilterField[]> = {
  dams: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'statusSlug', label: 'Trạng thái', type: 'enum', enumValues: [...DAM_STATUS_SLUGS] },
    { iso: 'ratedPower', label: 'Công suất (MW)', type: 'number' },       // Wattage_PL: real number
    { iso: 'commissioningYear', label: 'Năm vận hành', type: 'number' },  // year: real number where present
  ],
  rivers: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'streamOrder', label: 'Cấp sông', type: 'number' },  // Cap: real number
    { iso: 'length', label: 'Chiều dài (m)', type: 'number' },  // Chieu_dai: real number
  ],
  stations: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'measurementType', label: 'Loại trạm', type: 'text' },
    { iso: 'operationalStatus', label: 'Trạng thái', type: 'text' },
    { iso: 'measurementValue', label: 'Giá trị đo', type: 'text' },  // "Mực nước: 2.3m" — labeled string
  ],
  flood_zones: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'hazardType', label: 'Loại hiểm họa', type: 'text' },
    { iso: 'affectedArea', label: 'Diện tích ảnh hưởng', type: 'text' },  // "15.4 km2" — labeled string
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
  ],
  drought_points: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
    { iso: 'observedStatus', label: 'Trạng thái', type: 'text' },
    { iso: 'observationDate', label: 'Ngày khảo sát', type: 'date' },
  ],
  saltwater_intrusion: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'salinity', label: 'Độ mặn', type: 'text' },  // "4.2 g/l" — labeled string
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
    { iso: 'observedStatus', label: 'Trạng thái', type: 'text' },
  ],
  flood_generation: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
    { iso: 'catchmentArea', label: 'Diện tích lưu vực', type: 'text' },  // "120 km2" — labeled string
  ],
};
```

- [ ] **Step 4: Add the export**

In `packages/shared/src/index.ts`, after the line `export * from './feature-properties';`, add:

```ts
export * from './attribute-schema';
```

- [ ] **Step 5: Run test to verify it passes + rebuild shared**

Run: `npm test -w @webatlas/shared -- attribute-schema`
Expected: PASS (4 tests).

Run: `npm run build -w @webatlas/shared`
Expected: build succeeds — the web workspace now resolves `LAYER_FILTER_FIELDS` from `@webatlas/shared`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/attribute-schema.ts packages/shared/src/attribute-schema.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): attribute-schema (per-layer filterable fields, ISO-keyed)"
```

---

### Task 2: Pure filter — `features/attribute-filter/model/applyFilter.ts`

The testable core: match features against AND-ed conditions.

**Files:**
- Create: `apps/web/src/features/attribute-filter/model/applyFilter.ts`
- Test: `apps/web/src/features/attribute-filter/model/applyFilter.test.ts`

**Interfaces:**
- Produces: `Operator`, `Condition`, `FeatureLike`, `applyFilter(features, conditions)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/attribute-filter/model/applyFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyFilter, type FeatureLike, type Condition } from './applyFilter';

function feat(props: Record<string, unknown>, geom: unknown = { type: 'Point' }): FeatureLike {
  return { getProperties: () => props, getGeometry: () => geom };
}

describe('applyFilter', () => {
  const dams = [
    feat({ geographicalName: 'Đập A', statusSlug: 'xa_lu', ratedPower: 250 }),
    feat({ geographicalName: 'Đập B', statusSlug: 'binh_thuong', ratedPower: 100 }),
    feat({ geographicalName: 'Hồ C', statusSlug: 'xa_lu', ratedPower: 50 }),
  ];

  it('empty conditions -> empty result (no filter means no list)', () => {
    expect(applyFilter(dams, [])).toEqual([]);
  });

  it('eq on an enum matches exactly', () => {
    const r = applyFilter(dams, [{ field: 'statusSlug', op: 'eq', value: 'xa_lu' }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A', 'Hồ C']);
  });

  it('gte on a number', () => {
    const r = applyFilter(dams, [{ field: 'ratedPower', op: 'gte', value: 200 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A']);
  });

  it('lte on a number', () => {
    const r = applyFilter(dams, [{ field: 'ratedPower', op: 'lte', value: 100 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập B', 'Hồ C']);
  });

  it('between is inclusive on both ends', () => {
    const r = applyFilter(dams, [{ field: 'ratedPower', op: 'between', value: 50, value2: 100 }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập B', 'Hồ C']);
  });

  it('text eq is case-insensitive substring', () => {
    const r = applyFilter(dams, [{ field: 'geographicalName', op: 'eq', value: 'đập' }]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A', 'Đập B']);
  });

  it('multiple conditions are ANDed', () => {
    const r = applyFilter(dams, [
      { field: 'statusSlug', op: 'eq', value: 'xa_lu' },
      { field: 'ratedPower', op: 'gte', value: 200 },
    ]);
    expect(r.map((f) => f.getProperties().geographicalName)).toEqual(['Đập A']);
  });

  it('a missing/null property fails its condition without throwing', () => {
    const r = applyFilter([feat({ geographicalName: 'X' })], [{ field: 'ratedPower', op: 'gte', value: 1 }]);
    expect(r).toEqual([]);
  });

  it('a geometry-less feature can still match (list includes it)', () => {
    const r = applyFilter([feat({ statusSlug: 'xa_lu' }, null)], [{ field: 'statusSlug', op: 'eq', value: 'xa_lu' }]);
    expect(r).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- applyFilter`
Expected: FAIL — cannot resolve `./applyFilter`.

- [ ] **Step 3: Implement `applyFilter.ts`**

Create `apps/web/src/features/attribute-filter/model/applyFilter.ts`:

```ts
export type Operator = 'eq' | 'gte' | 'lte' | 'between';

export interface Condition {
  field: string;      // ISO property name on the feature
  op: Operator;
  value: unknown;
  value2?: unknown;   // upper bound for 'between'
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

function matchesCondition(props: Record<string, unknown>, c: Condition): boolean {
  const raw = props[c.field];
  if (raw === undefined || raw === null) return false;

  if (c.op === 'eq') {
    // Case-insensitive substring for text; exact-ish (lowercased) for enums too.
    return String(raw).toLowerCase().includes(String(c.value).toLowerCase());
  }
  const n = toNumber(raw);
  const a = toNumber(c.value);
  if (n === null || a === null) return false;
  if (c.op === 'gte') return n >= a;
  if (c.op === 'lte') return n <= a;
  if (c.op === 'between') {
    const b = toNumber(c.value2);
    if (b === null) return false;
    return n >= a && n <= b;
  }
  return false;
}

// AND semantics: a feature matches iff it satisfies EVERY condition.
// Empty conditions -> [] (no filter yields no list, per design §4.2).
export function applyFilter(features: FeatureLike[], conditions: Condition[]): FeatureLike[] {
  if (conditions.length === 0) return [];
  return features.filter((f) => {
    const props = f.getProperties();
    return conditions.every((c) => matchesCondition(props, c));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- applyFilter`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/attribute-filter/model/applyFilter.ts apps/web/src/features/attribute-filter/model/applyFilter.test.ts
git commit -m "feat(web): applyFilter pure core (AND-ed typed conditions)"
```

---

### Task 3: Presenter — `features/attribute-filter/model/useFilterPresenter.ts`

Derives the filter view-model from live map features.

**Files:**
- Create: `apps/web/src/features/attribute-filter/model/useFilterPresenter.ts`
- Test: `apps/web/src/features/attribute-filter/model/useFilterPresenter.test.ts`

**Interfaces:**
- Consumes: `LAYER_FILTER_FIELDS`, `FilterField`, `EditableLayerKey`, `LAYER_ATTRIBUTE_MAP` from `@webatlas/shared`; `applyFilter`, `Condition` from `./applyFilter`; `useMapContext` from `../../../app/providers/MapProvider`; `fromLonLat` from `ol/proj`.
- Produces: `FilterResult`, `useFilterPresenter()` view-model.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/attribute-filter/model/useFilterPresenter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A fake ol/Map exposing layers whose get('id') matches a layerStateId,
// each with a source of stub features.
function fakeFeature(props: Record<string, unknown>, coords: number[] | null = [108, 14]) {
  return {
    getProperties: () => props,
    getGeometry: () => (coords ? { getType: () => 'Point', getCoordinates: () => coords } : null),
    get: (k: string) => props[k],
  };
}
let animateSpy = vi.fn();
function fakeMap(featuresByLayerId: Record<string, unknown[]>) {
  const layers = Object.entries(featuresByLayerId).map(([id, features]) => ({
    get: (k: string) => (k === 'id' ? id : undefined),
    getSource: () => ({ getFeatures: () => features }),
  }));
  return {
    getLayers: () => ({ getArray: () => layers }),
    getView: () => ({ animate: animateSpy }),
  };
}

let mockMap: unknown = null;
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: mockMap, toggleLayerVisibility: vi.fn() }),
}));

import { useFilterPresenter } from './useFilterPresenter';

beforeEach(() => { mockMap = null; animateSpy = vi.fn(); });

describe('useFilterPresenter', () => {
  it('starts closed with no layer and no results', () => {
    const { result } = renderHook(() => useFilterPresenter());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.layerKey).toBeNull();
    expect(result.current.results).toEqual([]);
    expect(result.current.activeCount).toBe(0);
  });

  it('picking a layer populates its filter fields', () => {
    mockMap = fakeMap({ layer_dams: [] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.open());
    act(() => result.current.setLayer('dams'));
    expect(result.current.fields.some((f) => f.iso === 'statusSlug')).toBe(true);
  });

  it('reports layerLoaded=false when the layer has no loaded features', () => {
    mockMap = fakeMap({}); // dams layer absent
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    expect(result.current.layerLoaded).toBe(false);
  });

  it('derives results from live features once conditions are added', () => {
    mockMap = fakeMap({
      layer_dams: [
        fakeFeature({ geographicalName: 'Đập A', statusSlug: 'xa_lu', ratedPower: 250 }),
        fakeFeature({ geographicalName: 'Đập B', statusSlug: 'binh_thuong', ratedPower: 100 }),
      ],
    });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    expect(result.current.count).toBe(1);
    expect(result.current.results[0].label).toBe('Đập A');
    expect(result.current.activeCount).toBe(1);
  });

  it('clear removes all conditions and results', () => {
    mockMap = fakeMap({ layer_dams: [fakeFeature({ statusSlug: 'xa_lu' })] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    act(() => result.current.clear());
    expect(result.current.results).toEqual([]);
    expect(result.current.activeCount).toBe(0);
  });

  it('flyTo animates the view to a matched feature with geometry', () => {
    mockMap = fakeMap({ layer_dams: [fakeFeature({ geographicalName: 'Đập A', statusSlug: 'xa_lu' }, [108, 14])] });
    const { result } = renderHook(() => useFilterPresenter());
    act(() => result.current.setLayer('dams'));
    act(() => result.current.addCondition());
    act(() => result.current.updateCondition(0, { field: 'statusSlug', op: 'eq', value: 'xa_lu' }));
    act(() => result.current.flyTo(result.current.results[0].id));
    expect(animateSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- useFilterPresenter`
Expected: FAIL — cannot resolve `./useFilterPresenter`.

- [ ] **Step 3: Implement `useFilterPresenter.ts`**

Create `apps/web/src/features/attribute-filter/model/useFilterPresenter.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';
import { fromLonLat } from 'ol/proj';
import {
  LAYER_FILTER_FIELDS,
  LAYER_ATTRIBUTE_MAP,
  type FilterField,
  type EditableLayerKey,
} from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { applyFilter, type Condition, type FeatureLike } from './applyFilter';

export interface FilterResult {
  id: string;          // stable per-result id (index-based; features lack a guaranteed id here)
  label: string;       // geographicalName or a fallback
  subLabel: string;    // a secondary attribute for context
  hasGeometry: boolean;
}

// Filtering is a display tool. No auth, no fetch — it reads what the map already has.
export function useFilterPresenter() {
  const { map } = useMapContext();
  const [isOpen, setIsOpen] = useState(false);
  const [layerKey, setLayerKey] = useState<EditableLayerKey | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);

  const fields: FilterField[] = useMemo(
    () => (layerKey ? LAYER_FILTER_FIELDS[layerKey] : []),
    [layerKey],
  );

  // The live OL features for the active layer, or null if the layer isn't loaded.
  const liveFeatures = useMemo((): FeatureLike[] | null => {
    if (!map || !layerKey) return null;
    const stateId = LAYER_ATTRIBUTE_MAP[layerKey].layerStateId;
    const layer = map.getLayers().getArray().find((l: { get(k: string): unknown }) => l.get('id') === stateId) as
      | { getSource(): { getFeatures(): FeatureLike[] } | null }
      | undefined;
    const src = layer?.getSource?.();
    if (!src) return null;
    return src.getFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, layerKey]);

  const layerLoaded = liveFeatures !== null && liveFeatures.length > 0;

  const matched = useMemo(
    () => (liveFeatures ? applyFilter(liveFeatures, conditions) : []),
    [liveFeatures, conditions],
  );

  const results: FilterResult[] = useMemo(
    () =>
      matched.map((f, i) => {
        const p = f.getProperties();
        const secondary = fields.find((fl) => fl.iso !== 'geographicalName');
        return {
          id: String(i),
          label: String(p.geographicalName ?? p.localId ?? `#${i + 1}`),
          subLabel: secondary ? String(p[secondary.iso] ?? '') : '',
          hasGeometry: !!f.getGeometry(),
        };
      }),
    [matched, fields],
  );

  const setLayer = useCallback((key: EditableLayerKey) => {
    setLayerKey(key);
    setConditions([]);
  }, []);
  const addCondition = useCallback(() => {
    setConditions((cs) => [...cs, { field: fields[0]?.iso ?? '', op: 'eq', value: '' }]);
  }, [fields]);
  const updateCondition = useCallback((i: number, patch: Partial<Condition>) => {
    setConditions((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }, []);
  const removeCondition = useCallback((i: number) => {
    setConditions((cs) => cs.filter((_, idx) => idx !== i));
  }, []);
  const clear = useCallback(() => setConditions([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const flyTo = useCallback(
    (id: string) => {
      if (!map) return;
      const f = matched[Number(id)];
      const geom = f?.getGeometry() as { getCoordinates?: () => number[] } | null;
      const coords = geom?.getCoordinates?.();
      if (!coords) return;
      // Features are in EPSG:3857 already (source reprojects on load); animate to the map coord.
      map.getView().animate({ center: coords, zoom: 11, duration: 1000 });
      setIsOpen(false);
    },
    [map, matched],
  );

  return {
    isOpen, layerKey, fields, conditions, results,
    count: results.length,
    activeCount: conditions.length,
    layerLoaded,
    setLayer, addCondition, updateCondition, removeCondition, clear,
    open, close, flyTo,
  };
}
```

> **Note for the implementer:** the presenter test's `fakeFeature.getGeometry()` returns an object with `getCoordinates()` already in map coords, matching how OL stores loaded features (the source reprojected them on load). `fromLonLat` is imported for parity with `SearchBar` but is only needed if you fly to lon/lat; loaded features are already projected, so `flyTo` uses the coordinates directly. Keep the import only if used; remove it if lint flags it unused.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- useFilterPresenter`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/attribute-filter/model/useFilterPresenter.ts apps/web/src/features/attribute-filter/model/useFilterPresenter.test.ts
git commit -m "feat(web): useFilterPresenter (live features -> filtered result list)"
```

---

### Task 4: Views — `FilterButton`, `ConditionRow`, `FilterPanel`

Props-only.

**Files:**
- Create: `apps/web/src/features/attribute-filter/ui/FilterButton.view.tsx`
- Create: `apps/web/src/features/attribute-filter/ui/ConditionRow.view.tsx`
- Create: `apps/web/src/features/attribute-filter/ui/FilterPanel.view.tsx`
- Test: `apps/web/src/features/attribute-filter/ui/FilterButton.view.test.tsx`
- Test: `apps/web/src/features/attribute-filter/ui/FilterPanel.view.test.tsx`

**Interfaces:**
- Consumes: `FilterField`, `EditableLayerKey` from `@webatlas/shared`; `Condition`, `Operator` from `../model/applyFilter`; `FilterResult` from `../model/useFilterPresenter`.
- Produces: `FilterButtonView`, `ConditionRowView`, `FilterPanelView`, and a `LAYER_LABELS` const (Vietnamese layer names) exported from `FilterPanel.view.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/attribute-filter/ui/FilterButton.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterButtonView } from './FilterButton.view';

describe('FilterButtonView', () => {
  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<FilterButtonView activeCount={0} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /lọc/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows the active-condition count when > 0', () => {
    render(<FilterButtonView activeCount={2} onToggle={vi.fn()} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows no badge when count is 0', () => {
    render(<FilterButtonView activeCount={0} onToggle={vi.fn()} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
```

Create `apps/web/src/features/attribute-filter/ui/FilterPanel.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterPanelView } from './FilterPanel.view';

const baseProps = {
  layerKey: 'dams' as const,
  fields: [
    { iso: 'statusSlug', label: 'Trạng thái', type: 'enum' as const, enumValues: ['xa_lu', 'binh_thuong'] },
    { iso: 'ratedPower', label: 'Công suất (MW)', type: 'number' as const },
  ],
  conditions: [{ field: 'statusSlug', op: 'eq' as const, value: 'xa_lu' }],
  results: [{ id: '0', label: 'Đập A', subLabel: '250', hasGeometry: true }],
  count: 1,
  layerLoaded: true,
  onSelectLayer: vi.fn(),
  onAddCondition: vi.fn(),
  onUpdateCondition: vi.fn(),
  onRemoveCondition: vi.fn(),
  onClear: vi.fn(),
  onEnableLayer: vi.fn(),
  onResultClick: vi.fn(),
};

describe('FilterPanelView', () => {
  it('renders the result count and a result row', () => {
    render(<FilterPanelView {...baseProps} />);
    expect(screen.getByText(/1 kết quả/i)).toBeInTheDocument();
    expect(screen.getByText('Đập A')).toBeInTheDocument();
  });

  it('clicking a result calls onResultClick with its id', async () => {
    render(<FilterPanelView {...baseProps} />);
    await userEvent.click(screen.getByText('Đập A'));
    expect(baseProps.onResultClick).toHaveBeenCalledWith('0');
  });

  it('shows an enable prompt when the layer is not loaded', () => {
    render(<FilterPanelView {...baseProps} layerLoaded={false} results={[]} count={0} />);
    expect(screen.getByRole('button', { name: /bật lớp/i })).toBeInTheDocument();
  });

  it('clicking "Xóa lọc" calls onClear', async () => {
    render(<FilterPanelView {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: /xóa lọc/i }));
    expect(baseProps.onClear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @webatlas/web -- FilterButton.view FilterPanel.view`
Expected: FAIL — cannot resolve the view modules.

- [ ] **Step 3: Implement `FilterButton.view.tsx`**

Create `apps/web/src/features/attribute-filter/ui/FilterButton.view.tsx`:

```tsx
import { Filter } from 'lucide-react';

export function FilterButtonView({ activeCount, onToggle }: {
  activeCount: number;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="filter-btn glass-panel" onClick={onToggle} aria-label="Bộ lọc">
      <Filter size={18} />
      {activeCount > 0 && <span className="filter-btn-badge">{activeCount}</span>}
    </button>
  );
}
```

- [ ] **Step 4: Implement `ConditionRow.view.tsx`**

Create `apps/web/src/features/attribute-filter/ui/ConditionRow.view.tsx`:

```tsx
import { X } from 'lucide-react';
import type { FilterField } from '@webatlas/shared';
import type { Condition, Operator } from '../model/applyFilter';

export function ConditionRowView({ condition, fields, onChange, onRemove }: {
  condition: Condition;
  fields: FilterField[];
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.iso === condition.field) ?? fields[0];
  const isNumeric = field?.type === 'number' || field?.type === 'date';

  return (
    <div className="condition-row">
      <select
        className="condition-field"
        value={condition.field}
        onChange={(e) => onChange({ field: e.target.value })}
        aria-label="Thuộc tính"
      >
        {fields.map((f) => (
          <option key={f.iso} value={f.iso}>{f.label}</option>
        ))}
      </select>

      {isNumeric ? (
        <>
          <select
            className="condition-op"
            value={condition.op}
            onChange={(e) => onChange({ op: e.target.value as Operator })}
            aria-label="Toán tử"
          >
            <option value="gte">&ge;</option>
            <option value="lte">&le;</option>
            <option value="eq">=</option>
          </select>
          <input
            className="condition-value"
            type="number"
            value={condition.value === '' || condition.value == null ? '' : String(condition.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            aria-label="Giá trị"
          />
        </>
      ) : field?.type === 'enum' ? (
        <select
          className="condition-value"
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ op: 'eq', value: e.target.value })}
          aria-label="Giá trị"
        >
          <option value="">—</option>
          {field.enumValues!.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          className="condition-value"
          type="text"
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ op: 'eq', value: e.target.value })}
          aria-label="Giá trị"
        />
      )}

      <button type="button" className="condition-remove" onClick={onRemove} aria-label="Xóa điều kiện">
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Implement `FilterPanel.view.tsx`**

Create `apps/web/src/features/attribute-filter/ui/FilterPanel.view.tsx`:

```tsx
import { EDITABLE_LAYER_KEYS, type EditableLayerKey, type FilterField } from '@webatlas/shared';
import type { Condition } from '../model/applyFilter';
import type { FilterResult } from '../model/useFilterPresenter';
import { ConditionRowView } from './ConditionRow.view';

// Vietnamese display names for the layer picker (mirrors data/mockData).
export const LAYER_LABELS: Record<EditableLayerKey, string> = {
  dams: 'Đập & Hồ chứa',
  rivers: 'Mạng lưới sông ngòi',
  stations: 'Trạm quan trắc',
  flood_zones: 'Vùng ngập lụt',
  drought_points: 'Vùng hạn hán',
  saltwater_intrusion: 'Xâm nhập mặn',
  flood_generation: 'Vùng sinh lũ',
};

export function FilterPanelView(props: {
  layerKey: EditableLayerKey | null;
  fields: FilterField[];
  conditions: Condition[];
  results: FilterResult[];
  count: number;
  layerLoaded: boolean;
  onSelectLayer: (key: EditableLayerKey) => void;
  onAddCondition: () => void;
  onUpdateCondition: (i: number, patch: Partial<Condition>) => void;
  onRemoveCondition: (i: number) => void;
  onClear: () => void;
  onEnableLayer: () => void;
  onResultClick: (id: string) => void;
}) {
  const {
    layerKey, fields, conditions, results, count, layerLoaded,
    onSelectLayer, onAddCondition, onUpdateCondition, onRemoveCondition, onClear, onEnableLayer, onResultClick,
  } = props;

  return (
    <div className="filter-panel glass-panel" aria-label="Bộ lọc dữ liệu">
      <label className="filter-layer-label">
        Lớp
        <select
          className="filter-layer-select"
          value={layerKey ?? ''}
          onChange={(e) => onSelectLayer(e.target.value as EditableLayerKey)}
          aria-label="Lớp dữ liệu"
        >
          <option value="" disabled>Chọn lớp…</option>
          {EDITABLE_LAYER_KEYS.map((k) => (
            <option key={k} value={k}>{LAYER_LABELS[k]}</option>
          ))}
        </select>
      </label>

      {layerKey && !layerLoaded && (
        <div className="filter-empty">
          <p>Lớp chưa được tải.</p>
          <button type="button" onClick={onEnableLayer}>Bật lớp để lọc</button>
        </div>
      )}

      {layerKey && layerLoaded && (
        <>
          <div className="filter-conditions">
            {conditions.map((c, i) => (
              <ConditionRowView
                key={i}
                condition={c}
                fields={fields}
                onChange={(patch) => onUpdateCondition(i, patch)}
                onRemove={() => onRemoveCondition(i)}
              />
            ))}
            <button type="button" className="filter-add" onClick={onAddCondition}>+ thêm điều kiện</button>
          </div>

          <div className="filter-results-header">
            <span>{count} kết quả</span>
            <button type="button" className="filter-clear" onClick={onClear}>Xóa lọc</button>
          </div>

          <div className="filter-results">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="filter-result-item"
                onClick={() => onResultClick(r.id)}
                disabled={!r.hasGeometry}
              >
                <span className="filter-result-name">{r.label}</span>
                {r.subLabel && <span className="filter-result-sub">{r.subLabel}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- FilterButton.view FilterPanel.view`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/attribute-filter/ui/
git commit -m "feat(web): attribute-filter views (button, condition row, panel)"
```

---

### Task 5: Container + SearchBar wiring + CSS

Wire presenter to views; mount the funnel + panel inside `SearchBar`.

**Files:**
- Create: `apps/web/src/features/attribute-filter/index.tsx`
- Test: `apps/web/src/features/attribute-filter/index.test.tsx`
- Modify: `apps/web/src/components/SearchBar.tsx`
- Modify: `apps/web/src/styles/main.css`

**Interfaces:**
- Consumes: `useFilterPresenter` (Task 3); `FilterButtonView`, `FilterPanelView` (Task 4).
- Produces: default export `AttributeFilter`, rendered by `SearchBar`.

- [ ] **Step 1: Write the failing container test**

Create `apps/web/src/features/attribute-filter/index.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let vm: Record<string, unknown>;
vi.mock('./model/useFilterPresenter', () => ({ useFilterPresenter: () => vm }));

import AttributeFilter from './index';

beforeEach(() => {
  vm = {
    isOpen: false, layerKey: null, fields: [], conditions: [], results: [],
    count: 0, activeCount: 0, layerLoaded: false,
    setLayer: vi.fn(), addCondition: vi.fn(), updateCondition: vi.fn(),
    removeCondition: vi.fn(), clear: vi.fn(), open: vi.fn(), close: vi.fn(),
    flyTo: vi.fn(), toggle: vi.fn(),
  };
});

describe('AttributeFilter', () => {
  it('renders the funnel button, panel hidden when closed', () => {
    render(<AttributeFilter />);
    expect(screen.getByRole('button', { name: /lọc/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Bộ lọc dữ liệu')).not.toBeInTheDocument();
  });

  it('shows the panel when isOpen', () => {
    vm.isOpen = true;
    render(<AttributeFilter />);
    expect(screen.getByLabelText('Bộ lọc dữ liệu')).toBeInTheDocument();
  });

  it('funnel click toggles open (calls open when closed)', async () => {
    render(<AttributeFilter />);
    await userEvent.click(screen.getByRole('button', { name: /lọc/i }));
    expect(vm.open).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- attribute-filter/index`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement `index.tsx`**

Create `apps/web/src/features/attribute-filter/index.tsx`:

```tsx
import { useFilterPresenter } from './model/useFilterPresenter';
import { FilterButtonView } from './ui/FilterButton.view';
import { FilterPanelView } from './ui/FilterPanel.view';
import { useMapContext } from '../../app/providers/MapProvider';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

// Filtering is a display tool available to every role. No auth gate (design §2).
export default function AttributeFilter() {
  const s = useFilterPresenter();
  const { toggleLayerVisibility } = useMapContext();

  const onEnableLayer = () => {
    if (s.layerKey) toggleLayerVisibility(LAYER_ATTRIBUTE_MAP[s.layerKey].layerStateId);
  };

  return (
    <div className="attribute-filter">
      <FilterButtonView activeCount={s.activeCount} onToggle={s.isOpen ? s.close : s.open} />
      {s.isOpen && (
        <FilterPanelView
          layerKey={s.layerKey}
          fields={s.fields}
          conditions={s.conditions}
          results={s.results}
          count={s.count}
          layerLoaded={s.layerLoaded}
          onSelectLayer={s.setLayer}
          onAddCondition={s.addCondition}
          onUpdateCondition={s.updateCondition}
          onRemoveCondition={s.removeCondition}
          onClear={s.clear}
          onEnableLayer={onEnableLayer}
          onResultClick={s.flyTo}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- attribute-filter/index`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount `<AttributeFilter />` in `SearchBar`**

In `apps/web/src/components/SearchBar.tsx`, add the import after the existing imports (after the `GEOSERVER_URL` import on line 5):

```tsx
import AttributeFilter from '../features/attribute-filter';
```

Then, inside the `search-input-wrapper` div, immediately AFTER the `<input .../>` element (currently ends at line 67 with `/>`) and BEFORE the wrapper's closing `</div>` (line 68), add:

```tsx
        <AttributeFilter />
```

(The funnel button now sits inside the search input wrapper, to the right of the text field. The panel it opens is absolutely positioned below via CSS.)

- [ ] **Step 6: Add styles to `main.css`**

Append to `apps/web/src/styles/main.css`:

```css
/* Attribute filter (roadmap 2.3) */
.attribute-filter { position: relative; display: flex; align-items: center; }
.filter-btn {
  display: inline-flex; align-items: center; justify-content: center; position: relative;
  width: 34px; height: 34px; border: none; cursor: pointer; border-radius: 8px; padding: 0;
}
.filter-btn-badge {
  position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
  padding: 0 4px; border-radius: 8px; background: rgba(56, 189, 248, 0.9); color: #fff;
  font-size: 11px; line-height: 16px; text-align: center;
}
.filter-panel {
  position: absolute; top: calc(100% + 8px); right: 0; width: 320px; max-width: 90vw;
  z-index: 1050; display: flex; flex-direction: column; gap: 10px; padding: 12px;
  max-height: 60vh; overflow-y: auto;
}
.filter-layer-label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.filter-layer-select, .condition-field, .condition-op, .condition-value {
  font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.12);
}
.filter-conditions { display: flex; flex-direction: column; gap: 6px; }
.condition-row { display: flex; align-items: center; gap: 6px; }
.condition-field { flex: 1 1 auto; min-width: 0; }
.condition-value { width: 90px; }
.condition-remove, .filter-add, .filter-clear {
  border: none; background: transparent; cursor: pointer; font: inherit; padding: 4px 6px; border-radius: 6px;
}
.filter-add { align-self: flex-start; color: rgba(56,130,246,0.95); }
.filter-results-header { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.filter-results { display: flex; flex-direction: column; gap: 2px; }
.filter-result-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
  padding: 6px 8px; border: none; background: transparent; cursor: pointer; border-radius: 6px;
}
.filter-result-item:hover:not(:disabled) { background: rgba(56, 189, 248, 0.12); }
.filter-result-item:disabled { opacity: 0.5; cursor: default; }
.filter-result-name { font-weight: 600; font-size: 13px; }
.filter-result-sub { font-size: 12px; opacity: 0.7; }
.filter-empty { display: flex; flex-direction: column; gap: 8px; font-size: 13px; opacity: 0.85; }
```

- [ ] **Step 7: Run full suite + build + lint**

Run: `npm test -w @webatlas/web`
Expected: PASS — all web tests incl. the new filter tests.

Run: `npm run build -w @webatlas/web`
Expected: `tsc -b` + vite build succeed (no type errors from the SearchBar edit or the `@webatlas/shared` import).

Run: `npm run lint -w @webatlas/web`
Expected: no new errors. Remove any import the linter flags unused (e.g. `fromLonLat` in the presenter if it ended up unused).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/attribute-filter/index.tsx apps/web/src/features/attribute-filter/index.test.tsx apps/web/src/components/SearchBar.tsx apps/web/src/styles/main.css
git commit -m "feat(web): mount attribute filter in the search bar + styles"
```

---

### Task 6: Manual verification (/run)

Confirm filtering end-to-end against the live stack. Evidence per design §7.

**Files:** none.

- [ ] **Step 1: Bring the stack up**

Start Postgres + GeoServer (`docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`), the web dev server (`npm run dev:web`). The API is not needed (filtering is client-side over public WFS), but GeoServer must be up so layers load.

- [ ] **Step 2: Filter dams by status + power**

Open the app (logged out is fine — filtering is for everyone). Ensure the dams layer is on. Click the funnel button in the search bar.
- Pick layer **Đập & Hồ chứa**.
- Add a condition **Trạng thái = xa_lu**; confirm a result count and a list appear.
- Add a second condition **Công suất ≥ 200**; confirm the list narrows (AND).
- Click a result → the map flies to that dam.
- Click **Xóa lọc** → list clears.

- [ ] **Step 3: Filter a second layer**

Turn on **Vùng ngập lụt** (flood_zones). In the filter, pick that layer, filter by **Mức rủi ro = Cao**; confirm results. (The riskLevel enum values are Vietnamese — `Cao`/`Trung bình` — matching the seed data, not `low/medium/high`.) This proves the schema works across layers, not just dams.

- [ ] **Step 4: The not-loaded path**

Pick a layer that is toggled OFF / not yet loaded (e.g. **Trạm quan trắc** if off). Confirm the panel shows "Bật lớp để lọc" and the enable button turns the layer on, after which filtering works.

- [ ] **Step 5: Confirm map interactivity**

With the filter panel open, confirm the map still pans/zooms and the funnel badge shows the active-condition count. The panel is an overlay, not a modal blocker.

- [ ] **Step 6: Record the result**

Note: filter opens from the search bar; conditions AND correctly; count + list correct; fly-to works; second layer works; not-loaded prompt works; clear resets. Note any cosmetic offset issues (panel vs. search results dropdown overlap) for follow-up — not a blocker unless the panel is unusable.

---

## Self-Review

**1. Spec coverage (design §1–§9):**
- §1 filter over all layers, list + fly-to, no restyle → Tasks 2–5 ✓
- §2 client-side, everyone, top-bar funnel, AND-ed typed conditions → Tasks 3–5 ✓
- §3 ISO-name data path, `statusSlug` for dams, loaded-vs-not → Task 1 (`statusSlug`), Task 3 (`liveFeatures`, `layerLoaded`) ✓
- §4.1 attribute schema (ISO-keyed, typed, dams→statusSlug) → Task 1 ✓
- §4.2 `applyFilter` pure, empty→[], null-safe → Task 2 ✓
- §4.3 presenter view-model (all fields listed) → Task 3 ✓
- §5 data flow (pick→condition→results→flyTo→clear) → Tasks 3–5 ✓
- §6 edges (no conditions, not loaded, zero matches, no geometry, null) → Task 2 (null/empty/geom) + Task 3 (layerLoaded) + Task 4 (empty prompt, disabled row) ✓
- §7 testing (pure-core bulk, schema, presenter, views, /run, jsdom discipline) → Tasks 1–6 ✓
- §8 UI shape (funnel + badge, panel, VN copy) → Tasks 4–5 ✓
- §9 YAGNI (no search rewrite, no saved views, no restyle, AND-only, no CQL, one layer, no auth) → honored throughout ✓

**2. Placeholder scan:** none — every step has real code or an exact command with expected output. Enum values and field types were **verified against the real seed data** (`apps/api/src/db/seeds/data/*.geojson` + the dams/rivers sources `web/public/thuydienvietnam.geojson`/`thuyhe.geojson`): riskLevel is Vietnamese (`Cao`/`Trung bình`); dams `wattage_mw`/rivers `Cap`,`Chieu_dai` are real numbers; hazard `area`/`salinity` and station `value` are labeled strings and are typed `text`, not `number`.

**3. Type/name consistency:** `FilterField`/`FilterFieldType`/`LAYER_FILTER_FIELDS` (Task 1) consumed in Tasks 3,4. `Operator`/`Condition`/`FeatureLike`/`applyFilter` (Task 2) consumed in Tasks 3,4. `FilterResult` + presenter view-model keys (`isOpen,layerKey,fields,conditions,results,count,activeCount,layerLoaded,setLayer,addCondition,updateCondition,removeCondition,clear,open,close,flyTo`) (Task 3) consumed identically in Task 5's container + its mock. View prop names (Task 4) match the container's wiring (Task 5). `LAYER_LABELS` exported from `FilterPanel.view.tsx` (Task 4). `toggleLayerVisibility` + `LAYER_ATTRIBUTE_MAP[key].layerStateId` (verified) used in Task 5's enable path.

**4. Risks for the implementer:**
- **`flyTo` coordinate space:** loaded features are already EPSG:3857 (the source reprojects on load), so `flyTo` animates to `geom.getCoordinates()` directly — do NOT re-run `fromLonLat` on them (that double-projects). The import may end up unused; lint will flag it — remove it then. The `SearchBar`'s own `flyTo` uses `fromLonLat` because it reads raw lon/lat from the WFS JSON, a different path.
- **Field types match dirty data (Task 1), already reconciled:** `riskLevel` enum values are Vietnamese (`Cao`/`Trung bình`, verified in seeds — `Thấp` included defensively though not seen in current data). `area`/`salinity`/station `value` are labeled strings (`"120 km2"`), so they are typed `text` — a numeric `≥` would fail on them. Only genuinely-numeric fields (dams `ratedPower`, rivers `streamOrder`/`length`) are typed `number`. If `/run` surfaces another dirty field, retype it `text`; do not add unit-stripping parsing in this cut (YAGNI).
- **Panel vs. search-results dropdown:** both drop below the search bar. The filter panel is `right:0`; the search results are the existing dropdown. If `/run` shows them overlapping badly, adjust the panel offset — cosmetic, noted in Task 6 §6, not a correctness blocker.
- **Result `id` is index-based:** results are keyed by their index in the matched array; `flyTo(id)` indexes back into `matched`. Stable within a single filter evaluation (which is all that's needed — the list and the fly-to target are the same snapshot). Do not "improve" this into a feature-uuid lookup; loaded features have no guaranteed stable id in this path.
