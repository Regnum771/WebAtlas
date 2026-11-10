import type { Grant } from '@webatlas/shared';

export type Role = 'admin' | 'viewer';

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  isAdmin: boolean;
  grants: Grant[];
}

export type SignInMethod = 'local' | 'sso';

/** GET /api/auth/config. `sso` is null when the API has no single sign-on configured. */
export interface AuthConfig {
  sso: { loginPath: string; endSessionUrl: string } | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
