# Plan 3 — Frontend WFS Data-Source Swap (ISO/INSPIRE attributes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the seven thematic water/hazard layers in the public viewer from static GeoJSON/mock data to live GeoServer WFS, with feature attributes normalized to ISO 19103 / INSPIRE-Hydrography-aligned names — leaving the viewer visually and behaviourally unchanged.

**Architecture:** A canonical attribute mapping (DB snake_case column → ISO/INSPIRE `lowerCamelCase` name) lives in `@webatlas/shared`. The frontend loads each thematic layer from a WFS `GetFeature` (GeoJSON) URL through a normalization adapter that (a) renames properties to the ISO names, (b) tags each feature with its `layerKey`, and (c) drops features with null geometry. Styles, popup, legend, and search are updated to read the ISO names and to switch on `layerKey` instead of sniffing raw property names. GADM admin boundaries stay static/unchanged. No MVP/FSD restructure in this plan (that is Plan 3b); the current component layout is preserved.

**Tech Stack:** React 19, OpenLayers 10, TypeScript, Vite; `@webatlas/shared`; GeoServer 2.26 WFS 2.0 (GeoJSON output).

## Global Constraints

- Node 22 / npm 10 workspaces. This plan touches `apps/web` and `packages/shared` only (no `apps/api` changes).
- Requires Plans 1–2 merged/available: `apps/web` app, `@webatlas/shared`, and GeoServer serving `webatlas:<table>` WFS layers (Docker stack up).
- **INV-4:** the ISO attribute mapping is defined ONCE in `@webatlas/shared` and consumed by the frontend; do not hand-duplicate the name lists in components.
- **Attribute naming:** ISO 19103 `lowerCamelCase`; INSPIRE-Hydrography-aligned terms where a clear equivalent exists (see mapping table). Feature *type* discriminator is the `layerKey` (one of the seven canonical keys).
- **Visual/behaviour parity:** the public viewer must look and behave exactly as before the swap (same styling, popups, legend, search, filters). Only the data source and internal property names change.
- **Null geometry:** the 19 coordinate-less dams arrive from WFS as `"geometry": null`; the loader must drop them so OpenLayers never receives a null-geometry feature.
- GADM boundary layers (`layer_provinces_2026`, `layer_wards_2026`) and basemaps are unchanged.
- WFS base URL is configurable via `VITE_GEOSERVER_URL` (default `http://localhost:8080/geoserver`).

## Canonical attribute mapping (DB column → ISO/INSPIRE name)

Defined in `@webatlas/shared` (Task 1). `id` (uuid) is preserved as-is for future CRUD; `layerKey` is added by the loader.

**dams** (`webatlas:dams` — INSPIRE `DamOrWeir`)
| DB column | ISO/INSPIRE name |
|---|---|
| external_id | localId |
| name | geographicalName |
| name_en | geographicalNameEn |
| wattage_mw | ratedPower |
| annual_output | annualGeneration |
| year_launched | constructionYear |
| year_operational | commissioningYear |
| status | operationalStatus |

**rivers** (`webatlas:rivers` — INSPIRE `Watercourse`)
| external_id → localId · code → hydroId · name → geographicalName · stream_order → streamOrder · length_m → length |

**stations** (`webatlas:stations`)
| external_id → localId · name → geographicalName · station_type → measurementType · status → operationalStatus · value → measurementValue |

**flood_zones** (`webatlas:flood_zones`)
| external_id → localId · name → geographicalName · hazard_type → hazardType · area → affectedArea · risk_level → riskLevel |

**drought_points** (`webatlas:drought_points`)
| external_id → localId · name → geographicalName · risk_level → riskLevel · status → observedStatus · survey_date → observationDate |

**saltwater_intrusion** (`webatlas:saltwater_intrusion`)
| external_id → localId · name → geographicalName · salinity → salinity · risk_level → riskLevel · status → observedStatus |

**flood_generation** (`webatlas:flood_generation`)
| external_id → localId · name → geographicalName · risk_level → riskLevel · area → catchmentArea · flow_rate → flowCharacteristics |

Frontend `layerKey` → WFS `typeName` and legacy layer-state id (the map's `layersState` keys, unchanged):
| layerKey | WFS typeName | layersState id |
|---|---|---|
| dams | webatlas:dams | layer_dams |
| rivers | webatlas:rivers | layer_rivers |
| stations | webatlas:stations | layer_stations |
| flood_zones | webatlas:flood_zones | layer_flood |
| drought_points | webatlas:drought_points | layer_drought_survey |
| saltwater_intrusion | webatlas:saltwater_intrusion | layer_saltwater_intrusion |
| flood_generation | webatlas:flood_generation | layer_flood_generation |

> Note the non-obvious pairings: `flood_zones`↔`layer_flood`, `drought_points`↔`layer_drought_survey` (Plan 1 review carry-forward — not a mechanical prefix strip).

---

### Task 1: Define the ISO/INSPIRE attribute schema + normalizer in `@webatlas/shared`

**Files:**
- Create: `packages/shared/src/layer-attributes.ts`
- Create: `packages/shared/src/layer-attributes.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Interfaces:**
- Produces: `LAYER_ATTRIBUTE_MAP` (per `EditableLayerKey`: `{ wfsTypeName, layerStateId, attributes: Record<dbColumn, isoName> }`), and `normalizeFeatureProperties(layerKey, dbProps) → isoProps` which renames known columns, passes through `id`, and stamps `layerKey`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/layer-attributes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties } from './layer-attributes';

describe('LAYER_ATTRIBUTE_MAP', () => {
  it('covers every editable layer key', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(LAYER_ATTRIBUTE_MAP[key]).toBeDefined();
      expect(LAYER_ATTRIBUTE_MAP[key].wfsTypeName).toBe(`webatlas:${key}`);
    }
  });

  it('maps dam DB columns to ISO/INSPIRE names', () => {
    const a = LAYER_ATTRIBUTE_MAP.dams.attributes;
    expect(a.external_id).toBe('localId');
    expect(a.name).toBe('geographicalName');
    expect(a.wattage_mw).toBe('ratedPower');
    expect(a.year_operational).toBe('commissioningYear');
  });
});

describe('normalizeFeatureProperties', () => {
  it('renames known columns, keeps id, and stamps layerKey', () => {
    const out = normalizeFeatureProperties('dams', {
      id: 'uuid-1', external_id: 42, name: 'Hoa Binh', wattage_mw: 1920, status: null,
    });
    expect(out.localId).toBe(42);
    expect(out.geographicalName).toBe('Hoa Binh');
    expect(out.ratedPower).toBe(1920);
    expect(out.id).toBe('uuid-1');
    expect(out.layerKey).toBe('dams');
    // raw DB name is not leaked
    expect('wattage_mw' in out).toBe(false);
  });

  it('passes through unknown keys unchanged', () => {
    const out = normalizeFeatureProperties('rivers', { code: 'LA08', foo: 'bar' } as Record<string, unknown>);
    expect(out.hydroId).toBe('LA08');
    expect(out.foo).toBe('bar');
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `npm run test:shared`
Expected: FAIL — `layer-attributes` module / exports do not exist yet.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/layer-attributes.ts`:
```ts
import type { EditableLayerKey } from './index';

export interface LayerAttributeInfo {
  /** GeoServer WFS typeName, e.g. "webatlas:dams" */
  wfsTypeName: string;
  /** The map's layersState id (legacy, unchanged), e.g. "layer_dams" */
  layerStateId: string;
  /** DB column name -> ISO 19103 / INSPIRE-aligned attribute name */
  attributes: Record<string, string>;
}

export const LAYER_ATTRIBUTE_MAP: Record<EditableLayerKey, LayerAttributeInfo> = {
  dams: {
    wfsTypeName: 'webatlas:dams',
    layerStateId: 'layer_dams',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      name_en: 'geographicalNameEn',
      wattage_mw: 'ratedPower',
      annual_output: 'annualGeneration',
      year_launched: 'constructionYear',
      year_operational: 'commissioningYear',
      status: 'operationalStatus',
    },
  },
  rivers: {
    wfsTypeName: 'webatlas:rivers',
    layerStateId: 'layer_rivers',
    attributes: {
      external_id: 'localId',
      code: 'hydroId',
      name: 'geographicalName',
      stream_order: 'streamOrder',
      length_m: 'length',
    },
  },
  stations: {
    wfsTypeName: 'webatlas:stations',
    layerStateId: 'layer_stations',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      station_type: 'measurementType',
      status: 'operationalStatus',
      value: 'measurementValue',
    },
  },
  flood_zones: {
    wfsTypeName: 'webatlas:flood_zones',
    layerStateId: 'layer_flood',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      hazard_type: 'hazardType',
      area: 'affectedArea',
      risk_level: 'riskLevel',
    },
  },
  drought_points: {
    wfsTypeName: 'webatlas:drought_points',
    layerStateId: 'layer_drought_survey',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      risk_level: 'riskLevel',
      status: 'observedStatus',
      survey_date: 'observationDate',
    },
  },
  saltwater_intrusion: {
    wfsTypeName: 'webatlas:saltwater_intrusion',
    layerStateId: 'layer_saltwater_intrusion',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      salinity: 'salinity',
      risk_level: 'riskLevel',
      status: 'observedStatus',
    },
  },
  flood_generation: {
    wfsTypeName: 'webatlas:flood_generation',
    layerStateId: 'layer_flood_generation',
    attributes: {
      external_id: 'localId',
      name: 'geographicalName',
      risk_level: 'riskLevel',
      area: 'catchmentArea',
      flow_rate: 'flowCharacteristics',
    },
  },
};

/**
 * Rename a feature's DB-column properties to their ISO/INSPIRE names.
 * - `id` (uuid) is passed through unchanged (needed for future CRUD).
 * - Unknown keys are passed through unchanged.
 * - A `layerKey` discriminator is stamped onto the result.
 */
export function normalizeFeatureProperties(
  layerKey: EditableLayerKey,
  dbProps: Record<string, unknown>
): Record<string, unknown> {
  const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dbProps)) {
    if (k === 'id') {
      out.id = v;
    } else if (map[k]) {
      out[map[k]] = v;
    } else {
      out[k] = v;
    }
  }
  out.layerKey = layerKey;
  return out;
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, append:
```ts
export * from './layer-attributes';
```

- [ ] **Step 5: Run the tests + build to verify PASS**

Run from repo root:
```bash
npm run test:shared
npm run build:shared
```
Expected: all tests pass; `packages/shared/dist` rebuilt (the `prepare`/`build` emits `layer-attributes` in the bundle).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ 
git commit -m "feat(shared): ISO/INSPIRE layer attribute map + feature normalizer"
```

---

### Task 2: WFS config + normalized WFS source factory (with null-geometry filtering)

**Files:**
- Create: `apps/web/src/config.ts`
- Create: `apps/web/src/services/wfs.ts`
- Create: `apps/web/.env.example`
- Modify: `apps/web/package.json` (add `@webatlas/shared` dependency)

**Interfaces:**
- Consumes: `LAYER_ATTRIBUTE_MAP`, `normalizeFeatureProperties` from `@webatlas/shared`.
- Produces: `createWfsVectorSource(layerKey, style?)` returning an OpenLayers `VectorSource` that loads `webatlas:<key>` as GeoJSON, drops null-geometry features, reprojects 4326→3857, and normalizes properties to ISO names (+ `layerKey`). Also `GEOSERVER_URL`.

- [ ] **Step 1: Add the shared dependency to the web app**

In `apps/web/package.json`, add to `"dependencies"`:
```json
    "@webatlas/shared": "*",
```
Then from repo root run `npm install` (links the workspace).

- [ ] **Step 2: Create the config module**

Create `apps/web/src/config.ts`:
```ts
export const GEOSERVER_URL: string =
  import.meta.env.VITE_GEOSERVER_URL ?? 'http://localhost:8080/geoserver';
```

Create `apps/web/.env.example`:
```dotenv
# Base URL of the GeoServer instance serving the WFS layers
VITE_GEOSERVER_URL=http://localhost:8080/geoserver
```

- [ ] **Step 3: Create the WFS source factory**

Create `apps/web/src/services/wfs.ts`:
```ts
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import type { StyleLike } from 'ol/style/Style';
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { GEOSERVER_URL } from '../config';

function wfsUrl(typeName: string): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
  });
  return `${GEOSERVER_URL}/ows?${params.toString()}`;
}

/**
 * VectorSource for a thematic layer served from GeoServer WFS as GeoJSON.
 * - Reprojects EPSG:4326 -> EPSG:3857 (map view projection).
 * - Drops features with no geometry (e.g. coordinate-less dams).
 * - Renames properties to ISO/INSPIRE names and stamps `layerKey`.
 */
export function createWfsVectorSource(layerKey: EditableLayerKey): VectorSource {
  const info = LAYER_ATTRIBUTE_MAP[layerKey];
  const format = new GeoJSON();
  const source = new VectorSource({
    format,
    url: () => wfsUrl(info.wfsTypeName),
    strategy: bboxStrategy,
  });

  // Normalize + filter once features are loaded for this source.
  source.on('featuresloadend', (evt) => {
    const loaded = (evt as unknown as { features?: Feature[] }).features ?? source.getFeatures();
    for (const f of loaded) {
      if (!f.getGeometry()) {
        source.removeFeature(f);
        continue;
      }
      const raw = f.getProperties();
      // OpenLayers stores geometry under the geometry key; drop it before renaming props.
      const geomKey = f.getGeometryName();
      const dbProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k !== geomKey) dbProps[k] = v;
      }
      const iso = normalizeFeatureProperties(layerKey, dbProps);
      // Replace all non-geometry properties with the ISO-named set.
      for (const k of Object.keys(dbProps)) f.unset(k, true);
      f.setProperties(iso, true);
    }
    source.changed();
  });

  return source;
}
```

> Note: `createWfsVectorSource` uses the `bbox` loading strategy so OpenLayers requests features for the current viewport. Because normalization runs on `featuresloadend`, the read projection is applied by the `GeoJSON` format using the map view (set when the source is attached to a layer added to the map — OpenLayers infers `featureProjection` from the map). If features appear unprojected during implementation, pass an explicit `dataProjection: 'EPSG:4326'`/`featureProjection: 'EPSG:3857'` by reading features manually in a custom loader instead of the `url` shortcut — report if this occurs.

- [ ] **Step 4: Verify the app still builds**

Run from repo root:
```bash
npm run build:web
```
Expected: `tsc -b && vite build` succeed (no type errors from the new modules).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/config.ts apps/web/src/services/wfs.ts apps/web/.env.example apps/web/package.json package-lock.json
git commit -m "feat(web): WFS source factory with ISO normalization + null-geom filtering"
```

---

### Task 3: Swap dams + rivers to WFS; update their styles and search

**Files:**
- Modify: `apps/web/src/components/MapContainer.tsx` (dams/rivers layers + styles)
- Modify: `apps/web/src/components/SearchBar.tsx` (load dams from WFS, ISO names)

**Interfaces:**
- Consumes: `createWfsVectorSource` (Task 2). Dams features now carry `ratedPower`, `operationalStatus`, `localId`; rivers carry `streamOrder`.

- [ ] **Step 1: Point dams + rivers layers at WFS in MapContainer**

In `apps/web/src/components/MapContainer.tsx`:
1. Add import at top:
```ts
import { createWfsVectorSource } from '../services/wfs';
```
2. Replace the two `createVectorLayerFromUrl` calls for dams and rivers:
```ts
    const damsLayer = createVectorLayerFromUrl('layer_dams', './thuydienvietnam.geojson', damsStyle);
    const riversLayer = createVectorLayerFromUrl('layer_rivers', './thuyhe.geojson', riversStyle);
```
with vector layers built on the WFS source (keep the same `properties.id` + refs wiring):
```ts
    const damsLayer = new VectorLayer({ source: createWfsVectorSource('dams'), style: damsStyle, properties: { id: 'layer_dams' } });
    layersRef.current['layer_dams'] = damsLayer;
    const riversLayer = new VectorLayer({ source: createWfsVectorSource('rivers'), style: riversStyle, properties: { id: 'layer_rivers' } });
    layersRef.current['layer_rivers'] = riversLayer;
```

- [ ] **Step 2: Update `damsStyle` to ISO names**

In `MapContainer.tsx`, in `damsStyle`, replace the raw property reads:
```ts
      const id = feature.get('ID') || 0;
      const wattage = feature.get('Wattage_PL') || 50;
```
with:
```ts
      const id = feature.get('localId') || 0;
      const wattage = feature.get('ratedPower') || 50;
```
The status-derivation logic and `feature.set('status', status)` — change the set target to `operationalStatus` so the popup reads a consistent name:
```ts
      feature.set('operationalStatus', status);
```
(Keep the `reservoirFilterRef` filter logic identical; it compares the derived `status` local variable, not the property.)

- [ ] **Step 3: Update the reservoir filter selection interaction + `riversStyle`**

In `MapContainer.tsx` `riversStyle` (and the `Select` interaction style for rivers), replace:
```ts
      const cap = feature.get('Cap') || 6;
```
with:
```ts
      const cap = feature.get('streamOrder') || 6;
```
(There are two occurrences — the layer style and the `selectInteraction` style. Update both.)

- [ ] **Step 4: Update SearchBar to load dams from WFS with ISO names**

Replace `apps/web/src/components/SearchBar.tsx` entirely with:
```tsx
import React, { useState, useEffect } from 'react';
import { useMapContext } from './MapContext';
import { Search, MapPin } from 'lucide-react';
import { fromLonLat } from 'ol/proj';
import { GEOSERVER_URL } from '../config';

const DAMS_WFS_URL =
  `${GEOSERVER_URL}/ows?service=WFS&version=2.0.0&request=GetFeature` +
  `&typeNames=webatlas:dams&outputFormat=application/json&srsName=EPSG:4326`;

const SearchBar: React.FC = () => {
  const { map } = useMapContext();
  const [query, setQuery] = useState('');
  const [dams, setDams] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    fetch(DAMS_WFS_URL)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.features) {
          // Only dams with a geometry are searchable/navigable.
          const withGeom = data.features.filter((f: any) => f.geometry);
          setDams(withGeom);
          setResults(withGeom.slice(0, 10));
        }
      })
      .catch((err) => console.error('Error loading hydropower data for search:', err));
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (val.trim() === '') {
      setResults(dams.slice(0, 10));
    } else {
      const normVal = val.toLowerCase();
      setResults(
        dams.filter((f: any) => {
          const vnName = (f.properties.name || '').toLowerCase();
          const enName = (f.properties.name_en || '').toLowerCase();
          return vnName.includes(normVal) || enName.includes(normVal);
        })
      );
    }
  };

  const flyTo = (coordinates: number[]) => {
    if (!map) return;
    map.getView().animate({ center: fromLonLat(coordinates), zoom: 11, duration: 1000 });
    setShowResults(false);
    setQuery('');
  };

  return (
    <div className="search-bar-container">
      <div className="search-input-wrapper glass-panel">
        <Search className="search-icon" size={18} />
        <input
          type="text"
          placeholder="Tìm kiếm nhà máy thủy điện..."
          value={query}
          onChange={handleSearch}
          onFocus={() => setShowResults(true)}
          className="search-input"
        />
      </div>

      {showResults && results.length > 0 && (
        <div className="search-results glass-panel">
          {results.map((item: any, idx: number) => (
            <button
              key={item.properties.external_id || idx}
              className="search-result-item"
              onClick={() => flyTo(item.geometry.coordinates)}
            >
              <MapPin size={16} className="text-blue-500" />
              <div className="result-info">
                <span className="result-name">{item.properties.name}</span>
                <span className="result-desc">
                  Thủy điện {item.properties.wattage_mw ? `- ${item.properties.wattage_mw} MW` : ''}
                  {item.properties.year_operational ? ` (Vận hành: ${item.properties.year_operational})` : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
```
> SearchBar reads the raw WFS GeoJSON directly (not through the OL source), so it uses the **DB column names** (`name`, `name_en`, `wattage_mw`, `year_operational`, `external_id`) — these are the raw WFS property names, correct for a direct `fetch`.

- [ ] **Step 5: Verify the viewer renders dams + rivers from WFS**

Run from repo root (stack up):
```bash
npm run dev:web
```
Manually confirm in the browser (http://localhost:5173): dams render as sized/coloured circles, rivers render with width by order, clicking a dam shows the popup, and searching a dam name flies to it. Stop the dev server after confirming. (Automated visual parity is Task 5.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/MapContainer.tsx apps/web/src/components/SearchBar.tsx
git commit -m "feat(web): serve dams + rivers from WFS with ISO attribute names"
```

---

### Task 4: Swap the five hazard/station layers to WFS; update popup + legend

**Files:**
- Modify: `apps/web/src/components/MapContainer.tsx` (five mock layers → WFS; remove mock imports)
- Modify: `apps/web/src/components/DynamicPopup.tsx` (switch on `layerKey`, ISO names)

**Interfaces:**
- Consumes: `createWfsVectorSource`. Features now carry `layerKey` + ISO names (`riskLevel`, `observationDate`, `flowCharacteristics`, `measurementValue`, etc.).

- [ ] **Step 1: Point the five layers at WFS + drop mock imports**

In `MapContainer.tsx`, replace the five `createVectorLayer(...MockData...)` calls:
```ts
    const stationsLayer = createVectorLayer('layer_stations', stationsMockData, stationsStyle);
    const floodLayer = createVectorLayer('layer_flood', floodMockData, floodStyle);
    const droughtSurveyLayer = createVectorLayer('layer_drought_survey', droughtSurveyMockData, droughtSurveyStyle);
    const saltwaterIntrusionLayer = createVectorLayer('layer_saltwater_intrusion', saltwaterIntrusionMockData, saltwaterIntrusionStyle);
    const floodGenerationLayer = createVectorLayer('layer_flood_generation', floodGenerationMockData, floodGenerationStyle);
```
with WFS-backed layers:
```ts
    const mkWfs = (stateId: string, key: Parameters<typeof createWfsVectorSource>[0], style: any) => {
      const layer = new VectorLayer({ source: createWfsVectorSource(key), style, properties: { id: stateId } });
      layersRef.current[stateId] = layer;
      return layer;
    };
    const stationsLayer = mkWfs('layer_stations', 'stations', stationsStyle);
    const floodLayer = mkWfs('layer_flood', 'flood_zones', floodStyle);
    const droughtSurveyLayer = mkWfs('layer_drought_survey', 'drought_points', droughtSurveyStyle);
    const saltwaterIntrusionLayer = mkWfs('layer_saltwater_intrusion', 'saltwater_intrusion', saltwaterIntrusionStyle);
    const floodGenerationLayer = mkWfs('layer_flood_generation', 'flood_generation', floodGenerationStyle);
```
Then remove the now-unused mock imports at the top of the file:
```ts
import { 
  stationsMockData,
  floodMockData,
  droughtSurveyMockData,
  saltwaterIntrusionMockData,
  floodGenerationMockData
} from '../data/mockData';
```
(These five styles do not read feature properties, so no style edits are needed for these layers.)

- [ ] **Step 2: Rewrite the popup content dispatch to switch on `layerKey`**

In `apps/web/src/components/DynamicPopup.tsx`, the WFS features now carry `layerKey` and ISO names. Replace the property-sniffing branches in `renderPopupContent` (the blocks for dams, rivers, stations, flood, drought, saltwater, flood-generation) with a `layerKey` switch. Replace the body of `renderPopupContent` from the start of block "1. Nếu là Hồ chứa/Đập" through the end of block "4c. Nếu là Vùng sinh lũ" with:
```tsx
    // Thematic WFS layers are discriminated by layerKey (ISO/INSPIRE attributes).
    if (props.layerKey === 'dams') {
      return (
        <>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Công suất: <strong>{props.ratedPower} MW</strong></span></div>
          {props.annualGeneration != null && (
            <div className="info-row"><Droplets size={14} className="text-blue-500" />
              <span>Sản lượng điện: <strong>{props.annualGeneration} GWh/năm</strong></span></div>)}
          {props.commissioningYear && (
            <div className="info-row"><Activity size={14} className="text-blue-500" />
              <span>Năm vận hành: <strong>{props.commissioningYear}</strong></span></div>)}
          {props.constructionYear && (
            <div className="info-row"><Info size={14} className="text-blue-500" />
              <span>Khởi công: <strong>{props.constructionYear}</strong></span></div>)}
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Trạng thái: <strong className={`status-text ${props.operationalStatus === 'Nguy hiểm' ? 'text-red-500' : props.operationalStatus === 'Xả lũ' ? 'text-amber-500' : 'text-emerald-500'}`}>{props.operationalStatus || 'Bình thường'}</strong></span></div>
          <div className="diagrammatic-info">
            <div className="title">Nền đồ giải (Cartodiagram):</div>
            <ul>
              <li><strong>Kích thước biểu tượng:</strong> Tỷ lệ công suất ({props.ratedPower} MW)</li>
              <li><strong>Màu sắc biểu tượng:</strong> Trạng thái ({props.operationalStatus || 'Bình thường'})</li>
            </ul>
          </div>
          <div className="status-filter-container">
            <div className="title">Lọc hồ chứa theo trạng thái:</div>
            <div className="status-filter-buttons">
              {(['all', 'binh_thuong', 'xa_lu', 'nguy_hiem'] as const).map((filterVal) => {
                const labels = { all: 'Tất cả', binh_thuong: 'Bình thường', xa_lu: 'Xả lũ', nguy_hiem: 'Nguy hiểm' };
                return (
                  <button key={filterVal} onClick={() => setReservoirFilter(filterVal)}
                    className={`filter-btn-tag ${reservoirFilter === filterVal ? 'active-filter' : ''}`}>
                    {labels[filterVal]}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      );
    }
    if (props.layerKey === 'rivers') {
      const lengthStr = props.length != null ? `${(props.length / 1000).toFixed(2)} km` : '—';
      return (
        <>
          {props.hydroId && (
            <div className="info-row"><Database size={14} className="text-blue-500" />
              <span>Mã phân đoạn: <strong>{props.hydroId}</strong></span></div>)}
          {props.streamOrder != null && (
            <div className="info-row"><Info size={14} className="text-blue-500" />
              <span>Cấp sông: <strong>Cấp {props.streamOrder}</strong></span></div>)}
          <div className="info-row"><Droplets size={14} className="text-blue-500" />
            <span>Chiều dài: <strong>{lengthStr}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'stations') {
      return (
        <>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Loại trạm: <strong>{props.measurementType}</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Giá trị đo: <strong>{props.measurementValue}</strong></span></div>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Trạng thái hoạt động: <strong>{props.operationalStatus}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'flood_zones') {
      return (
        <>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Phân loại: <strong>{props.hazardType}</strong></span></div>
          <div className="info-row"><Droplets size={14} className="text-blue-500" />
            <span>Diện tích ảnh hưởng: <strong>{props.affectedArea}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'drought_points') {
      return (
        <>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Phân loại: <strong>Khảo sát hạn hán</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Trạng thái: <strong>{props.observedStatus}</strong></span></div>
          {props.observationDate && (
            <div className="info-row"><Database size={14} className="text-blue-500" />
              <span>Ngày khảo sát: <strong>{props.observationDate}</strong></span></div>)}
        </>
      );
    }
    if (props.layerKey === 'saltwater_intrusion') {
      return (
        <>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Phân loại: <strong>Xâm nhập mặn</strong></span></div>
          <div className="info-row"><Droplets size={14} className="text-blue-500" />
            <span>Độ mặn đo được: <strong>{props.salinity}</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Trạng thái: <strong>{props.observedStatus}</strong></span></div>
        </>
      );
    }
    if (props.layerKey === 'flood_generation') {
      return (
        <>
          <div className="info-row"><Info size={14} className="text-blue-500" />
            <span>Phân loại: <strong>Vùng sinh lũ</strong></span></div>
          <div className="info-row"><Database size={14} className="text-blue-500" />
            <span>Diện tích lưu vực: <strong>{props.catchmentArea}</strong></span></div>
          <div className="info-row"><Activity size={14} className="text-blue-500" />
            <span>Đặc điểm lũ: <strong>{props.flowCharacteristics}</strong></span></div>
        </>
      );
    }
```
Leave the GADM branches (blocks "5", "6", and the default) intact — those features are static and keep their original property names.

- [ ] **Step 3: Update the popup header, risk badge, and dam-detail trigger to ISO names**

In `DynamicPopup.tsx`:
1. The `isDamOrReservoir` check and `detail` computation:
```ts
  const isDamOrReservoir = props.Wattage_PL !== undefined || (props.capacity !== undefined && props.basin !== undefined);
  const detail = isDamOrReservoir ? getDetailedDamInfo(props.ID || props.id, props.Vietnamese || props.Ten || props.name || 'Đập & Hồ chứa', props.Wattage_PL) : null;
```
becomes:
```ts
  const isDamOrReservoir = props.layerKey === 'dams';
  const detail = isDamOrReservoir ? getDetailedDamInfo(props.localId || 0, props.geographicalName || 'Đập & Hồ chứa', props.ratedPower) : null;
```
2. The popup title + risk badge:
```tsx
          <h3 className="popup-title">{props.Vietnamese || props.Ten || props.name || (props.OBJECTID ? `Sông ngòi (ID: ${props.OBJECTID})` : 'Đối tượng không tên')}</h3>
          {props.riskLevel && (
```
becomes:
```tsx
          <h3 className="popup-title">{props.geographicalName || props.name || (props.layerKey === 'rivers' ? `Sông ngòi (${props.hydroId ?? props.localId})` : 'Đối tượng không tên')}</h3>
          {props.riskLevel && (
```
(The `riskLevel` name is already ISO — `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation` all map `risk_level → riskLevel`, so the badge keeps working.)

- [ ] **Step 4: Verify build + lint**

Run from repo root:
```bash
npm run build:web
npm run lint:web
```
Expected: build succeeds (no unused-import errors — the mock imports were removed), lint clean.

- [ ] **Step 5: Manual popup/legend parity check**

Run `npm run dev:web`; in the browser toggle each hazard/station layer on, click a feature, and confirm the popup shows the same fields as before (station value, flood area, drought status/date, salinity, flood-generation catchment/flow). The legend (`DynamicLegend.tsx`) references only `layer.id` values, which are unchanged, so it needs no edits — confirm each legend entry still appears. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/MapContainer.tsx apps/web/src/components/DynamicPopup.tsx
git commit -m "feat(web): serve hazard/station layers from WFS; popup switches on layerKey"
```

---

### Task 5: Parity verification + mock cleanup

**Files:**
- Modify: `apps/web/src/data/mockData.ts` (remove the seven swapped collections; keep only what's still used)
- Verify only: build, lint, run

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Confirm what still uses `mockData.ts`**

Run from repo root:
```bash
grep -rn "mockData" apps/web/src || echo "no references"
```
Expected: after Tasks 3–4, the only remaining import of `mockData` should be `layerGroups` (used by `MapContext.tsx` and `LayerTree.tsx`). The seven feature collections (`riversMockData`, `stationsMockData`, `floodMockData`, `droughtSurveyMockData`, `saltwaterIntrusionMockData`, `floodGenerationMockData`, plus `provincialMockData`/`districtMockData` if unused) are no longer imported.

- [ ] **Step 2: Remove the now-unused mock feature collections**

In `apps/web/src/data/mockData.ts`, delete the exported constants that Step 1 shows are no longer imported anywhere (the thematic feature collections). **Keep `layerGroups`** (still consumed by `MapContext`/`LayerTree`). Do not remove anything Step 1 shows as still referenced.

- [ ] **Step 3: Verify build + lint after cleanup**

Run from repo root:
```bash
npm run build:web
npm run lint:web
```
Expected: both pass (no dangling references to deleted exports).

- [ ] **Step 4: End-to-end parity run**

Run `npm run dev:web` with the Docker stack up. Verify against the pre-swap behaviour:
- All seven thematic layers render identically (dam sizes/colours, river widths, hazard polygons/points).
- Popups show the correct fields for each layer type.
- The reservoir status filter still filters dams.
- Search finds and flies to dams.
- The legend shows entries for visible layers.
- GADM provinces/wards and basemaps are unchanged.
Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/mockData.ts
git commit -m "chore(web): drop mock feature collections now served from WFS"
```

---

## Self-Review

**1. Spec coverage (design §7.4 data-source swap, §13 Plan 3, INV-4):**
- Thematic layers read from GeoServer WFS → Tasks 3–4 ✓
- ISO/INSPIRE attribute naming defined once in `@webatlas/shared` (INV-4) → Task 1 ✓
- Normalization + null-geometry filtering on load → Task 2 ✓
- Styles/popup/search/legend updated for new names, visual parity → Tasks 3–5 ✓
- GADM/basemaps unchanged → preserved throughout ✓
- MVP/FSD refactor **explicitly deferred to Plan 3b** (scope decision) — not a gap.

**2. Placeholder scan:** No TBD/TODO; full code or exact edits given for every step.

**3. Name consistency:** ISO names used in the popup/style/search match the `LAYER_ATTRIBUTE_MAP` values from Task 1 exactly (`ratedPower`, `operationalStatus`, `streamOrder`, `hydroId`, `riskLevel`, `hazardType`, `affectedArea`, `observedStatus`, `observationDate`, `catchmentArea`, `flowCharacteristics`, `measurementType`, `measurementValue`, `geographicalName`, `localId`). SearchBar deliberately uses raw DB names (`name`, `wattage_mw`, …) because it fetches WFS directly, bypassing the OL normalizer — flagged in its step.

**4. Known risks for the implementer:**
- OpenLayers projection when using the `url` shortcut + `featuresloadend` normalization: if features render in the wrong place, switch to a manual loader with explicit `dataProjection`/`featureProjection` (noted in Task 2 Step 3).
- The dam `operationalStatus` is *derived* client-side from `localId` (unchanged demo logic); the DB `status` column is null, so the popup shows the derived value via `feature.set('operationalStatus', ...)` in the style — parity preserved.
- WFS `bbox` strategy re-requests on pan/zoom; the `featuresloadend` handler must be idempotent (it renames only raw DB keys; already-normalized features have no raw keys left to rename). If double-normalization is observed, guard with a `f.get('layerKey')` check before renaming.

---

## Follow-on

- **Plan 3b** — MVP/Feature-Sliced Design refactor: restructure `apps/web/src` into `shared/ · entities/ · features/` with model/presenter/view, move the WFS service into `features/map/model`, and split each panel into a passive view + presenter. The ISO attribute layer from this plan carries over unchanged.
- **Plan 4** — API control plane (auth + users), then Plan 5 admin editing, which will reuse `LAYER_ATTRIBUTE_MAP` for attribute forms.
