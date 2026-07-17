import type { Role } from '../session/model/session.types';

export type PersonaId = 'public' | 'governance' | 'research' | 'steward' | 'admin';

export interface Persona {
  id: PersonaId;
  label: string;
  requiredRole: Role | null; // null = anonymous/public
}

export const PERSONAS: Record<PersonaId, Persona> = {
  public:     { id: 'public',     label: 'Public',       requiredRole: null },
  governance: { id: 'governance', label: 'Governance',   requiredRole: 'viewer' },
  research:   { id: 'research',   label: 'Research',     requiredRole: 'viewer' },
  steward:    { id: 'steward',    label: 'Data Steward', requiredRole: 'editor' },
  admin:      { id: 'admin',      label: 'Management',   requiredRole: 'admin' },
};

// Which personas a role may inhabit. admin is a superset (steward + admin).
export function rolePersonas(role: Role | null | undefined): PersonaId[] {
  if (role === 'admin') return ['steward', 'admin'];
  if (role === 'editor') return ['steward'];
  if (role === 'viewer') return ['governance', 'research'];
  return ['public'];
}
