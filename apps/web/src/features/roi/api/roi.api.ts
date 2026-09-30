import type { ReferenceLayerKey, ResolvedRoi, Roi } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export function resolveRoi(roi: Roi): Promise<ResolvedRoi> {
  return apiRequest<ResolvedRoi>('/api/roi/resolve', { method: 'POST', body: JSON.stringify({ roi }) });
}

export interface MemberEntity { entityId: string; name: string | null; ref: string | null }

/** The whole entities a clicked basemap segment belongs to (Task 7). */
export async function fetchEntitiesByMember(layer: ReferenceLayerKey, osmId: string): Promise<MemberEntity[]> {
  const body = await apiRequest<{ entities: MemberEntity[] }>(
    `/api/reference/${layer}/entities?member=${encodeURIComponent(osmId)}`
  );
  return body.entities;
}
