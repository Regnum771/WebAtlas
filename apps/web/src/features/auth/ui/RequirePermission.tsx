import type { ReactNode } from 'react';
import type { Permission } from '@webatlas/shared';
import { useSession } from '../../../entities/session/model/session.store';
import { useCan } from '../../../entities/session/model/useCan';

// UX gate ONLY. The API checks jurisdiction and review rights on every write.
export function RequirePermission({ permission, mode = 'any', fallback = null, children }: {
  permission: Permission | Permission[];
  mode?: 'any' | 'all';
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { status } = useSession();
  const can = useCan();
  // Still resolving a stored session: decide nothing yet, or a redirect fallback would fire early.
  if (status === 'authenticating') return null;
  const wanted = Array.isArray(permission) ? permission : [permission];
  const allowed = mode === 'all' ? wanted.every((p) => can(p)) : wanted.some((p) => can(p));
  return <>{allowed ? children : fallback}</>;
}
