import { apiRequest } from '../../../shared/api/apiClient';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

export interface CreateFeaturePayload {
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown>;
}

/** A non-blocking note from the API about a save that went through. */
export interface SaveWarning {
  code: string;
  message: string;
}

export interface SaveResult {
  id: string;
  warnings: SaveWarning[];
}

export async function createFeature(key: string, payload: CreateFeaturePayload): Promise<SaveResult> {
  const body = await apiRequest<{ feature: { id: string }; warnings?: SaveWarning[] }>(`/api/layers/${key}/features`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: body.feature.id, warnings: body.warnings ?? [] };
}

/** The managing unit the initial-assignment rule gives a geometry. */
export async function suggestManagingUnit(geometry: GeoJSONGeometry): Promise<string> {
  const { unit } = await apiRequest<{ unit: string }>('/api/admin-units/suggest', {
    method: 'POST',
    body: JSON.stringify({ geometry }),
  });
  return unit;
}

export interface UpdateFeaturePayload {
  geometry?: GeoJSONGeometry;
  properties: Record<string, unknown>;
  /** Required by the proposal wizard; the API stores it on the audit row. */
  source?: { document: string; provider: string };
}

export async function updateFeature(key: string, id: string, payload: UpdateFeaturePayload): Promise<SaveResult> {
  const body = await apiRequest<{ feature: { id: string }; warnings?: SaveWarning[] }>(`/api/layers/${key}/features/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return { id: body.feature.id, warnings: body.warnings ?? [] };
}

export async function deleteFeature(key: string, id: string): Promise<void> {
  await apiRequest<void>(`/api/layers/${key}/features/${id}`, { method: 'DELETE' });
}
