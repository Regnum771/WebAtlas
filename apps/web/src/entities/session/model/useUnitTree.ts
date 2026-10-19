import { useQuery } from '@tanstack/react-query';
import type { UnitTree } from '@webatlas/shared';
import { fetchUnitTree } from '../api/unitTree.api';
import { useSession } from './session.store';

/** The administrative unit tree, loaded once per page load; null until it arrives or while signed out. */
export function useUnitTree(): UnitTree | null {
  const { status } = useSession();
  const query = useQuery({
    queryKey: ['admin-unit-tree'],
    queryFn: fetchUnitTree,
    staleTime: Infinity,
    enabled: status === 'authenticated',
  });
  return query.data ?? null;
}
