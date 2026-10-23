import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const listMaps = vi.fn();
const getMap = vi.fn();
const createMap = vi.fn();
const updateMap = vi.fn();
const deleteMap = vi.fn();
const listUploads = vi.fn();
vi.mock('../api/workspace.api', () => ({
  listMaps: () => listMaps(),
  getMap: (id: string) => getMap(id),
  createMap: (i: unknown) => createMap(i),
  updateMap: (id: string, i: unknown) => updateMap(id, i),
  deleteMap: (id: string, r: number) => deleteMap(id, r),
  listUploads: () => listUploads(),
}));

import { useMyMapsPanelPresenter } from './useMyMapsPanelPresenter';
import { resetMyMapsStore, getMyMaps } from './myMaps.store';

const MINE = { id: 'm1', title: 'Lũ Đà Nẵng', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 3, updatedAt: '2026-10-01T00:00:00Z', layerCount: 2, role: 'owner' as const };
const SHARED = { ...MINE, id: 'm2', title: 'Sông Hàn', ownerId: 'u2', ownerName: 'Lan', revision: 5, role: 'recipient' as const };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useMyMapsPanelPresenter(), { wrapper });
}

beforeEach(() => {
  [listMaps, getMap, createMap, updateMap, deleteMap, listUploads].forEach((m) => m.mockReset());
  resetMyMapsStore();
  listMaps.mockResolvedValue({ mine: [MINE], sharedWithMe: [SHARED] });
  listUploads.mockResolvedValue({ uploads: [], usageBytes: 2048, quotaBytes: 1073741824 });
  getMap.mockImplementation(async (id: string) => ({ ...(id === 'm1' ? MINE : SHARED), layers: [] }));
});

describe('useMyMapsPanelPresenter', () => {
  it('lists own and shared maps; a shared card names its owner', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.own.map((c) => c.title)).toEqual(['Lũ Đà Nẵng']);
    expect(result.current.own[0].ownerLabel).toBeNull();
    expect(result.current.shared.map((c) => c.title)).toEqual(['Sông Hàn']);
    expect(result.current.shared[0].ownerLabel).toBe('của Lan');
    await waitFor(() => expect(result.current.usage).toEqual({ usageBytes: 2048, quotaBytes: 1073741824 }));
  });

  it('creating a map adds it to Của tôi and expands it', async () => {
    const created = { ...MINE, id: 'm3', title: 'Mới', revision: 1, layerCount: 0, layers: [] };
    createMap.mockResolvedValue(created);
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    listMaps.mockResolvedValue({ mine: [MINE, created], sharedWithMe: [SHARED] });
    act(() => result.current.openCreate());
    act(() => result.current.setTitle('Mới'));
    await act(async () => { await result.current.submit(); });
    expect(createMap).toHaveBeenCalledWith({ title: 'Mới' });
    await waitFor(() => expect(result.current.own.map((c) => c.id)).toEqual(['m1', 'm3']));
    expect(getMyMaps().expanded.has('m3')).toBe(true);
    expect(result.current.dialog.open).toBe(false);
  });

  it('deleting asks first and sends the revision', async () => {
    deleteMap.mockResolvedValue(undefined);
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.askDelete('m1'));
    expect(deleteMap).not.toHaveBeenCalled();
    expect(result.current.pendingDelete).toBe(true);
    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteMap).toHaveBeenCalledWith('m1', 3);
    expect(result.current.pendingDelete).toBe(false);
  });

  it('a recipient gets no rename or delete actions', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.own[0].canWrite).toBe(true);
    expect(result.current.shared[0].canWrite).toBe(false);
  });
});
