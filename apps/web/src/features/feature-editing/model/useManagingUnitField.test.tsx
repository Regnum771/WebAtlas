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
// Stable identity, as in the app: the geometry is state, and a new object is a new shape.
const G1 = geom(1);
const both = (unit: string): Grant[] => [
  { permission: 'feature.create', unit }, { permission: 'feature.update', unit }, { permission: 'submission.review', unit },
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
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: G1, initial: '' }), { wrapper });
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
      ({ g }) => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: g, initial: '' }),
      { wrapper, initialProps: { g: geom(1) } },
    );
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    act(() => { result.current.setValue('48'); });
    rerender({ g: geom(2) });
    await flush();
    expect(result.current.value).toBe('48');
  });

  it('options are limited to the jurisdiction', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: null, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.options.map((n) => n.code).sort()).toEqual(['20194', '48']);
  });

  it('options need submission.review as well as the operation right (R7)', async () => {
    mockUser = { isAdmin: false, grants: [{ permission: 'feature.create', unit: '48' }, { permission: 'feature.update', unit: '48' }] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: null, initial: '' }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.options).toEqual([]);
  });

  it('create offers the units where feature.create and submission.review hold (the API checks feature.create)', async () => {
    mockUser = { isAdmin: false, grants: [
      { permission: 'feature.create', unit: '48' }, { permission: 'submission.review', unit: '48' },
      { permission: 'feature.update', unit: '51' }, { permission: 'submission.review', unit: '51' },
    ] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: null, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.options.map((n) => n.code).sort()).toEqual(['20194', '48']);
  });

  it('edit offers the units where feature.update and submission.review hold', async () => {
    mockUser = { isAdmin: false, grants: [
      { permission: 'feature.create', unit: '48' }, { permission: 'submission.review', unit: '48' },
      { permission: 'feature.update', unit: '51' }, { permission: 'submission.review', unit: '51' },
    ] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '51' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.options.map((n) => n.code)).toEqual(['51']);
  });

  it('drops the old suggestion as soon as the geometry changes, so a quick save cannot send it', async () => {
    suggest.mockResolvedValueOnce('20194').mockResolvedValueOnce('48');
    const { result, rerender } = renderHook(
      ({ g }) => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: g, initial: '' }),
      { wrapper, initialProps: { g: geom(1) } },
    );
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    expect(result.current.submittable).toBe('20194');
    rerender({ g: geom(2) });
    // Inside the debounce window: nothing to send yet (the API then suggests from the new shape).
    expect(result.current.suggestion).toBeNull();
    expect(result.current.submittable).toBeNull();
    await flush();
    expect(result.current.submittable).toBe('48');
  });

  it('an admin gets the whole tree', async () => {
    mockUser = { isAdmin: true, grants: [] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: null, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options).toHaveLength(4));
  });

  it('ignores a stale suggestion that lands after a newer one', async () => {
    let first!: (u: string) => void;
    suggest.mockImplementationOnce(() => new Promise<string>((r) => { first = r; })).mockResolvedValueOnce('48');
    const { result, rerender } = renderHook(
      ({ g }) => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: g, initial: '' }),
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
      ({ g }) => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: g, initial: '' }),
      { wrapper, initialProps: { g: geom(1) } },
    );
    rerender({ g: geom(2) });
    rerender({ g: geom(3) });
    await flush();
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('a failed suggestion sets no value and hints to choose', async () => {
    suggest.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: G1, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    expect(result.current.value).toBe('');
    expect(result.current.hint).toBe('Không gợi ý được đơn vị — hãy chọn.');
  });

  it('shows a suggestion outside the options with an error and does not allow submitting it', async () => {
    suggest.mockResolvedValue('51');
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: G1, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    await flush();
    expect(result.current.value).toBe('51');
    expect(result.current.error).toBe('Quảng Ngãi nằm ngoài phạm vi của anh/chị — hãy chọn đơn vị khác.');
    expect(result.current.submittable).toBeNull();
  });

  it('edit: a current unit outside the options is read-only and locks the save', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '51' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.readOnlyText).toBe('Quảng Ngãi — ngoài phạm vi của anh/chị');
    expect(result.current.locked).toBe(true);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('edit: a feature without a unit counts as national, as the API reads it', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.readOnlyText).toBe('Việt Nam — ngoài phạm vi của anh/chị');
    expect(result.current.locked).toBe(true);
  });

  it('edit: locked while the tree loads for a non-admin, never for an admin', async () => {
    const officer = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '48' }), { wrapper });
    expect(officer.result.current.locked).toBe(true);
    expect(officer.result.current.readOnlyText).toBeNull();
    await waitFor(() => expect(officer.result.current.locked).toBe(false));
    mockUser = { isAdmin: true, grants: [] };
    const admin = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '99999' }), { wrapper });
    expect(admin.result.current.locked).toBe(false);
  });

  it('create is never locked', async () => {
    mockUser = { isAdmin: false, grants: [] };
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: null, initial: '' }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.locked).toBe(false);
  });

  it('edit: a unit inside the options is editable and keeps its value', async () => {
    const { result } = renderHook(() => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '48' }), { wrapper });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.readOnlyText).toBeNull();
    expect(result.current.locked).toBe(false);
    expect(result.current.value).toBe('48');
  });
});

describe('useManagingUnitField with anyUnit (a personal edit copy)', () => {
  it("the managing unit picker in an edit copy offers units outside the user's jurisdiction", async () => {
    suggest.mockResolvedValue('51');
    const { result } = renderHook(
      () => useManagingUnitField({ layerKey: 'dams', mode: 'create', geometry: G1, initial: '', anyUnit: true }), { wrapper },
    );
    await waitFor(() => expect(result.current.options).toHaveLength(4));
    expect(result.current.allowed('51')).toBe(true);
    await flush();
    // The suggestion is the default, even outside the jurisdiction: the check comes at submit (P4).
    expect(result.current.value).toBe('51');
    expect(result.current.error).toBeNull();
    expect(result.current.submittable).toBe('51');
  });

  it('edit: a current unit outside the jurisdiction stays editable', async () => {
    mockUser = { isAdmin: false, grants: [] };
    const { result } = renderHook(
      () => useManagingUnitField({ layerKey: 'dams', mode: 'edit', geometry: null, initial: '51', anyUnit: true }), { wrapper },
    );
    await waitFor(() => expect(result.current.options).toHaveLength(4));
    expect(result.current.locked).toBe(false);
    expect(result.current.readOnlyText).toBeNull();
    expect(result.current.submittable).toBe('51');
  });
});
