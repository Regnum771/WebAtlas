import type { ReactNode } from 'react';
import { useSession } from '../../../entities/session/model/session.store';
import { useCanSaveDirectly } from '../../../entities/session/model/useCanSaveDirectly';

// UX gate ONLY: renders its children for an admin or a user holding feature.update and
// submission.review on a common unit (shared canSaveDirectly). The API checks every write.
export function RequireSaveDirectly({ fallback = null, children }: { fallback?: ReactNode; children: ReactNode }) {
  const { status } = useSession();
  const allowed = useCanSaveDirectly();
  // Still resolving a stored session: decide nothing yet.
  if (status === 'authenticating') return null;
  return <>{allowed ? children : fallback}</>;
}
