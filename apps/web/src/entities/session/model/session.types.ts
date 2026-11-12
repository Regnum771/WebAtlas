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

export interface LoginCredentials {
  email: string;
  password: string;
}
