import { apiRequest } from '../../../shared/api/apiClient';
import type { CurrentUser, LoginCredentials } from '../model/session.types';

export function loginRequest(c: LoginCredentials): Promise<{ token: string; user: CurrentUser }> {
  return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(c) });
}

export async function fetchMe(): Promise<CurrentUser> {
  const { user } = await apiRequest<{ user: CurrentUser }>('/api/auth/me');
  return user;
}
