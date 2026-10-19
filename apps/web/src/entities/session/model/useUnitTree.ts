import { useQuery } from '@tanstack/react-query';
import type { UnitTree } from '@webatlas/shared';
import { fetchUnitTree } from '../api/unitTree.api';

// Loaded for everyone, signed in or not: everyone reads, feature cards name their managing
// unit, and GET /api/admin-units/tree is public. Per-unit permission answers stay false for
// a signed-out visitor through useCan.
function useUnitTreeQuery() {
  return useQuery({
    queryKey: ['admin-unit-tree'],
    queryFn: fetchUnitTree,
    staleTime: Infinity,
  });
}

/** The administrative unit tree, loaded once per page load; null until it arrives. */
export function useUnitTree(): UnitTree | null {
  return useUnitTreeQuery().data ?? null;
}

export interface UnitTreeStatus {
  status: 'loading' | 'error' | 'ready';
  retry: () => void;
}

/** Same request as useUnitTree, but tells loading and failed apart. */
export function useUnitTreeStatus(): UnitTreeStatus {
  const q = useUnitTreeQuery();
  const status = q.data ? 'ready' : q.isError ? 'error' : 'loading';
  return { status, retry: () => { void q.refetch(); } };
}
