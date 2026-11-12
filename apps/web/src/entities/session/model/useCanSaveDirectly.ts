import { canSaveDirectly } from '@webatlas/shared';
import { useSession } from './session.store';
import { useUnitTree } from './useUnitTree';

/**
 * UX gate: admin, or feature.update and submission.review on a common unit (the shared rule the
 * API also applies to the assistant's proposal tool). False while signed out, and for a
 * non-admin until the unit tree has loaded. The API enforces every write regardless.
 */
export function useCanSaveDirectly(): boolean {
  const { currentUser } = useSession();
  const tree = useUnitTree();
  if (!currentUser) return false;
  if (currentUser.isAdmin) return true;
  return tree !== null && canSaveDirectly(currentUser.grants, tree);
}
