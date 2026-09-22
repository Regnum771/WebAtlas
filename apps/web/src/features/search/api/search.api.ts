import { apiRequest } from '../../../shared/api/apiClient';
import type { EditableLayerKey, GeoJsonGeometry } from '@webatlas/shared';

export type SearchHit =
  | {
      /** An editable water feature (dam, lake, river, station) — has an edit path. */
      source: 'layer';
      layerKey: EditableLayerKey;
      featureId: string;
      name: string;
      lonLat: [number, number];
    }
  | {
      /**
       * A dissolved OpenStreetMap basemap entity (road, railway, water body,
       * landuse area, place). Not editable: no feature id in the water layers,
       * no edit path. `featureId` is an opaque `<layer>:<md5>:<cluster>` id, and
       * `layerKey` is a reference-layer key (e.g. 'roads'), not an EditableLayerKey.
       */
      source: 'reference';
      layerKey: string;
      featureId: string;
      name: string;
      lonLat: [number, number];
    };

// Every source /api/search accepts (see apps/api search/repository.ts SEARCH_SOURCES):
// the four editable water layers plus the reference basemap layers, prefixed 'ref:'.
const SOURCES = [
  'dams', 'lakes', 'rivers', 'stations',
  'ref:roads', 'ref:railways', 'ref:water', 'ref:landuse', 'ref:places',
].join(',');

export async function fetchSearch(q: string): Promise<SearchHit[]> {
  const body = await apiRequest<{ results: SearchHit[] }>(
    `/api/search?q=${encodeURIComponent(q)}&sources=${encodeURIComponent(SOURCES)}`
  );
  return body.results;
}

export async function fetchFeatureGeometry(
  layerKey: EditableLayerKey,
  featureId: string
): Promise<{ name: string | null; geometry: GeoJsonGeometry }> {
  return apiRequest(`/api/features/${layerKey}/${encodeURIComponent(featureId)}/geometry`);
}
