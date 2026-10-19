import type { EditableLayerKey } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export interface UnassignedFeature {
  layerKey: EditableLayerKey;
  id: string;
  externalId: string | null;
  name: string | null;
}

/** Features whose managing unit is still empty, across all editable layers. */
export function fetchUnassigned(): Promise<{ features: UnassignedFeature[] }> {
  return apiRequest<{ features: UnassignedFeature[] }>('/api/layers/unassigned');
}
