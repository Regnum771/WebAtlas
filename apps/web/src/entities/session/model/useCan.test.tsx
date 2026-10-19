import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Grant, UnitNode } from '@webatlas/shared';

let mockUser: { isAdmin: boolean; grants: Grant[] } | null;
vi.mock('./session.store', () => ({
  useSession: () => ({ status: mockUser ? 'authenticated' : 'anonymous', currentUser: mockUser }),
}));

const UNITS: UnitNode[] = [
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '51', level: 'province', parent: 'VN', name: 'Quảng Ngãi' },
  { code: '20194', level: 'ward', parent: '48', name: 'Hải Châu' },
];
const tree = vi.hoisted(() => ({ resolve: undefined as undefined | (() => void) }));
vi.mock('../api/unitTree.api', async () => {
  const shared = await import('@webatlas/shared');
  return {
    fetchUnitTree: () => new Promise((res) => { tree.resolve = () => res(shared.buildUnitTree(UNITS)); }),
  };
});

import { useCan } from './useCan';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  tree.resolve = undefined;
  mockUser = { isAdmin: false, grants: [{ permission: 'feature.update', unit: '48' }] };
});

describe('useCan', () => {
  it('answers anywhere and per unit', async () => {
    const { result } = renderHook(() => useCan(), { wrapper });
    await waitFor(() => expect(tree.resolve).toBeDefined());
    tree.resolve!();
    await waitFor(() => expect(result.current('feature.update', '20194')).toBe(true));
    expect(result.current('feature.update')).toBe(true);
    expect(result.current('feature.update', '51')).toBe(false);
    expect(result.current('feature.delete')).toBe(false);
  });

  it('is false per unit while the tree loads, yet anywhere works', () => {
    const { result } = renderHook(() => useCan(), { wrapper });
    expect(result.current('feature.update', '48')).toBe(false);
    expect(result.current('feature.update')).toBe(true);
  });

  it('always passes for an admin and never for a signed-out visitor', () => {
    mockUser = { isAdmin: true, grants: [] };
    const admin = renderHook(() => useCan(), { wrapper });
    expect(admin.result.current('users.manage', '51')).toBe(true);
    mockUser = null;
    const anon = renderHook(() => useCan(), { wrapper });
    expect(anon.result.current('feature.update')).toBe(false);
  });
});
