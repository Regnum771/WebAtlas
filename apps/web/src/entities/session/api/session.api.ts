import { apiRequest } from '../../../shared/api/apiClient';
import { API_BASE_URL } from '../../../shared/config';
import type { AuthConfig, CurrentUser, LoginCredentials } from '../model/session.types';

export function loginRequest(c: LoginCredentials): Promise<{ token: string; user: CurrentUser }> {
  return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(c) });
}

export async function fetchMe(): Promise<CurrentUser> {
  const { user } = await apiRequest<{ user: CurrentUser }>('/api/auth/me');
  return user;
}

export function fetchAuthConfig(): Promise<AuthConfig> {
  return apiRequest<AuthConfig>('/api/auth/config');
}

/** Leaves the app for the API's SSO start, which redirects to Keycloak and back to /dang-nhap/xong. */
export function startSsoLogin(loginPath: string, returnTo: string): void {
  const url = new URL(`${API_BASE_URL}${loginPath}`, window.location.origin);
  url.searchParams.set('returnTo', returnTo);
  window.location.assign(url.toString());
}
