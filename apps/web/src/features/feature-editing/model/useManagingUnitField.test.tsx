import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Grant, UnitNode } from '@webatlas/shared';

let mockUser: { isAdmin: boolean; grants: Grant[] } | null;
vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ status: 'authenticated', currentUser: mockUser }),
}));

const UNITS: UnitNode[] = [
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  { code: '51', level: 'province', parent: 'VN', name: 'Quảng Ngãi' },
  { code: '20194', level: 'ward', parent: '48', name: 'Hải Châu' },
];
vi.mock('../../../entities/session/api/unitTree.api', async () => {
  const shared = await import('@webatlas/shared');
  return { fetchUnitTree: () => Promise.resolve(shared.buildUnitTree(UNITS)) };
});

const suggest = vi.fn();
vi.mock('../api/features.api', () => ({ suggestManagingUnit: (...a: unknown[]) => suggest(...a) }));

import { useManagingUnitField } from './useManagingUnitField';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
const geom = (n: number) => ({ type: 'Point', coordinates: [n, n] });
const both = (unit: string): Grant[] => [
  { permission: 'feature.update', unit }, { permission: 'submission.review', unit },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  suggest.mockReset();
  mockUser = { isAdmin: false, grants: both('48') };
});
afterEach(() => { vi.useRealTimers(); });

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(350); });

describe('useManagingUnitField', () => {
  it('create prefills the suggested ward', async () => {
    suggest.mockResolvedValue('20194');
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: geom(1), initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(result.current.suggestion).toBe('20194');
    expect(result.current.value).toBe('20194');
    expect(result.current.error).toBeNull();
  });

  it('a user-chosen unit is not overwritten by a later suggestion', async () => {
    suggest.mockResolvedValue('20194');
    const { result, rerender } = renderHook(
      ({ g }) => useManagingUnitField({ layerKey: 'dams', geometry: g, initial: '' }),
      { wrapper, initialProps: { g: geom(1) } },
    );
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    act(() => { result.current.setValue('48'); });
    rerender({ g: geom(2) });
    await flush();
    expect(result.current.value).toBe('48');
  });

  it('options are limited to the jurisdiction', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: null, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.options.map((n) => n.code).sort()).toEqual(['20194', '48']);
  });

  it('options need submission.review as well as feature.update (R7)', async () => {
    mockUser = { isAdmin: false, grants: [{ permission: 'feature.update', unit: '48' }] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: null, initial: '' }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.options).toEqual([]);
  });

  it('an admin gets the whole tree', async () => {
    mockUser = { isAdmin: true, grants: [] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: null, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options).toHaveLength(4));
  });

  it('ignores a stale suggestion that lands after a newer one', async () => {
    let first!: (u: string) => void;
    suggest.mockImplementationOnce(() => new Promise<string>((r) => { first = r; })).mockResolvedValueOnce('48');
    const { result, rerender } = renderHook(
      ({ g }) => useManagingUnitField({ layerKey: 'dams', geometry: g, initial: '' }),
      { wrapper, initialProps: { g: geom(1) } },
    );
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    rerender({ g: geom(2) });
    await flush();
    await act(async () => { first('20194'); });
    expect(result.current.value).toBe('48');
  });

  it('debounces suggestions while the geometry keeps changing', async () => {
    suggest.mockResolvedValue('48');
    const { rerender } = renderHook(
      ({ g }) => useManagingUnitField({ layerKey: 'dams', geometry: g, initial: '' }),
      { wrapper, initialProps: { g: geom(1) } },
    );
    rerender({ g: geom(2) });
    rerender({ g: geom(3) });
    await flush();
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('a failed suggestion sets no value and hints to choose', async () => {
    suggest.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: geom(1), initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    expect(result.current.value).toBe('');
    expect(result.current.hint).toBe('Không gợi ý được đơn vị — hãy chọn.');
  });

  it('shows a suggestion outside the options with an error and does not allow submitting it', async () => {
    suggest.mockResolvedValue('51');
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: geom(1), initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    expect(result.current.value).toBe('51');
    expect(result.current.error).toBe('Quảng Ngãi nằm ngoài phạm vi của anh/chị — hãy chọn đơn vị khác.');
    expect(result.current.submittable).toBeNull();
  });

  it('edit: a current unit outside the options is read-only', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: null, initial: '51' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.readOnlyText).toBe('Quảng Ngãi — ngoài phạm vi của anh/chị');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('edit: a unit inside the options is editable and keeps its value', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', geometry: null, initial: '48' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.readOnlyText).toBeNull();
    expect(result.current.value).toBe('48');
  });
});
