import type { Permission } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export interface AccessGroup {
  id: string;
  name: string;
  description: string | null;
  units: string[];
  permissions: Permission[];
  memberCount: number;
}

export interface GroupInput {
  name: string;
  description?: string;
  units: string[];
  permissions: Permission[];
}

export function listGroups(): Promise<AccessGroup[]> {
  return apiRequest<{ groups: AccessGroup[] }>('/api/access-groups', undefined).then((r) => r.groups);
}

export function createGroup(input: GroupInput): Promise<AccessGroup> {
  return apiRequest<{ group: AccessGroup }>('/api/access-groups', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.group);
}

export function updateGroup(id: string, input: GroupInput): Promise<AccessGroup> {
  return apiRequest<{ group: AccessGroup }>(`/api/access-groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }).then((r) => r.group);
}

export function deleteGroup(id: string): Promise<void> {
  return apiRequest<void>(`/api/access-groups/${id}`, { method: 'DELETE' });
}
