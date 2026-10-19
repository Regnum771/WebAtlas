import { useQuery } from '@tanstack/react-query';
import type { UnitTree } from '@webatlas/shared';
import { fetchUnitTree } from '../api/unitTree.api';
import { useSession } from './session.store';

function useUnitTreeQuery() {
  const { status } = useSession();
  return useQuery({
    queryKey: ['admin-unit-tree'],
    queryFn: fetchUnitTree,
    staleTime: Infinity,
    enabled: status === 'authenticated',
  });
}

/** The administrative unit tree, loaded once per page load; null until it arrives or while signed out. */
export function useUnitTree(): UnitTree | null {
  return useUnitTreeQuery().data ?? null;
}

export interface UnitTreeStatus {
  /** idle: signed out (query disabled). */
  status: 'idle' | 'loading' | 'error' | 'ready';
  retry: () => void;
}

/** Same request as useUnitTree, but tells loading, failed and signed out apart. */
export function useUnitTreeStatus(): UnitTreeStatus {
  const q = useUnitTreeQuery();
  const status = q.data ? 'ready' : q.isError ? 'error' : q.isPending && q.fetchStatus === 'idle' ? 'idle' : 'loading';
  return { status, retry: () => { void q.refetch(); } };
}
