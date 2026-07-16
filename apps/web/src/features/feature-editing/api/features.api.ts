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
