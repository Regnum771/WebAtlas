import type { Map as OlMap } from 'ol';
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { LAYER_LABELS } from './layerLabels';

const MAX_RESULTS = 20;

export interface SearchHit {
  label: string;                 // the feature's geographicalName
  layerKey: EditableLayerKey;
  layerLabel: string;            // Vietnamese layer name, for the result tag
  geometry: unknown;            // ol Geometry | null, for fly-to (kept opaque here)
}

interface FeatureLike {
  getProperties(): Record<string, unknown>;
  getGeometry(): unknown;
}

// Search feature names across ALL loaded thematic layers (case-insensitive substring
// on geographicalName). Reflects what's on the map — a layer with no loaded features
// simply contributes no hits. No fetch; reads the live vector sources.
export function searchAllLayers(map: OlMap | null, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!map || q === '') return [];

  const hits: SearchHit[] = [];
  for (const layerKey of EDITABLE_LAYER_KEYS) {
    const stateId = LAYER_ATTRIBUTE_MAP[layerKey].layerStateId;
    const layer = map.getLayers().getArray().find(
      (l: { get(k: string): unknown }) => l.get('id') === stateId,
    ) as { getSource(): { getFeatures(): FeatureLike[] } | null } | undefined;
    const src = layer?.getSource?.();
    if (!src) continue;

    for (const f of src.getFeatures()) {
      const name = f.getProperties().geographicalName;
      if (typeof name !== 'string' || !name.toLowerCase().includes(q)) continue;
      hits.push({
        label: name,
        layerKey,
        layerLabel: LAYER_LABELS[layerKey],
        geometry: f.getGeometry(),
      });
      if (hits.length >= MAX_RESULTS) return hits;
    }
  }
  return hits;
}
