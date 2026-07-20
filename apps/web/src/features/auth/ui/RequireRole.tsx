import type { ReactNode } from 'react';
import { useSession } from '../../../entities/session/model/session.store';
import type { Role } from '../../../entities/session/model/session.types';

// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// admin route); a user who forces this open still cannot perform admin API calls.
export function RequireRole({ role, fallback = null, children }: {
  role: Role | Role[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { status, currentUser } = useSession();
  // Still resolving a stored session on cold load: decide nothing yet, or we
  // would redirect an authenticated user before rehydration finishes.
  if (status === 'authenticating') return null;
  const allowed = Array.isArray(role) ? role : [role];
  if (!currentUser || !allowed.includes(currentUser.role)) return <>{fallback}</>;
  return <>{children}</>;
}
