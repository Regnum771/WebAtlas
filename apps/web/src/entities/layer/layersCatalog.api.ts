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
