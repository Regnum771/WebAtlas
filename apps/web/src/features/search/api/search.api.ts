import { apiRequest } from '../../../shared/api/apiClient';
import type { EditableLayerKey, GeoJsonGeometry } from '@webatlas/shared';

export interface SearchHit {
  layerKey: EditableLayerKey;
  featureId: string;
  name: string;
  lonLat: [number, number];
}

export async function fetchSearch(q: string): Promise<SearchHit[]> {
  const body = await apiRequest<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
  return body.results;
}

export async function fetchFeatureGeometry(
  layerKey: EditableLayerKey,
  featureId: string
): Promise<{ name: string | null; geometry: GeoJsonGeometry }> {
  return apiRequest(`/api/features/${layerKey}/${encodeURIComponent(featureId)}/geometry`);
}
