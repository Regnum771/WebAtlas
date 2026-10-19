import { can, type Permission } from '@webatlas/shared';
import { useSession } from './session.store';
import { useUnitTree } from './useUnitTree';

/**
 * UX gate helper. Without `unit` it answers "anywhere"; with a unit it needs the
 * unit tree and answers false until the tree has loaded. Admin always passes.
 * The API enforces every write regardless.
 */
export function useCan(): (permission: Permission, unit?: string) => boolean {
  const { currentUser } = useSession();
  const tree = useUnitTree();
  return (permission, unit) => {
    if (!currentUser) return false;
    if (currentUser.isAdmin) return true;
    if (unit === undefined) return currentUser.grants.some((g) => g.permission === permission);
    return tree !== null && can(currentUser.grants, permission, unit, tree);
  };
}
