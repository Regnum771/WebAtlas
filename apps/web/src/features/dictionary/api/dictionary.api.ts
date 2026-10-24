import type { DictFeatureType } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export interface ServedDictionary {
  version: string;
  featureTypes: DictFeatureType[];
}

export function fetchDictionary(): Promise<ServedDictionary> {
  return apiRequest<ServedDictionary>('/api/dictionary');
}
