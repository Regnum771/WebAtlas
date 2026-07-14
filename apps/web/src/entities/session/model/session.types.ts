export type Role = 'admin' | 'editor' | 'viewer';

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
