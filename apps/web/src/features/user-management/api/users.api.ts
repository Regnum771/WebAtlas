import { apiRequest } from '../../../shared/api/apiClient';
import type { Role } from '../../../entities/session/model/session.types';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput { email: string; password: string; full_name?: string; role: Role; }
export interface UpdateUserPatch { full_name?: string | null; role?: Role; is_active?: boolean; }

export function listUsers(): Promise<AdminUser[]> {
  return apiRequest<{ users: AdminUser[] }>('/api/users').then((r) => r.users);
}

export function createUser(input: CreateUserInput): Promise<AdminUser> {
  return apiRequest<{ user: AdminUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.user);
}

export function updateUser(id: string, patch: UpdateUserPatch): Promise<AdminUser> {
  return apiRequest<{ user: AdminUser }>(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  }).then((r) => r.user);
}
