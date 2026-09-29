import type { ResolvedRoi, Roi } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export function resolveRoi(roi: Roi): Promise<ResolvedRoi> {
  return apiRequest<ResolvedRoi>('/api/roi/resolve', { method: 'POST', body: JSON.stringify({ roi }) });
}
