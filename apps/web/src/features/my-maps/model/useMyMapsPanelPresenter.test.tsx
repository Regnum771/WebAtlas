import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const listMaps = vi.fn();
const getMap = vi.fn();
const createMap = vi.fn();
const updateMap = vi.fn();
const deleteMap = vi.fn();
const listUploads = vi.fn();
const copyMap = vi.fn();
vi.mock('../api/workspace.api', () => ({
  listMaps: () => listMaps(),
  getMap: (id: string) => getMap(id),
  createMap: (i: unknown) => createMap(i),
  updateMap: (id: string, i: unknown) => updateMap(id, i),
  deleteMap: (id: string, r: number) => deleteMap(id, r),
  listUploads: () => listUploads(),
  copyMap: (id: string) => copyMap(id),
}));

import { useMyMapsPanelPresenter } from './useMyMapsPanelPresenter';
import { ApiError } from '../../../shared/api/apiClient';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { keys, MAP_CHANGED_COPY } from './queries';
import { resetMyMapsStore, getMyMaps, expandMap, setTruncated } from './myMaps.store';
import { getTableState, resetTableStore } from './table.store';
import { getShell, openTool, resetShell } from '../../shell/model/shell.store';

const MINE = { id: 'm1', title: 'Lũ Đà Nẵng', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 3, updatedAt: '2026-10-01T00:00:00Z', layerCount: 2, role: 'owner' as const };
const SHARED = { ...MINE, id: 'm2', title: 'Sông Hàn', ownerId: 'u2', ownerName: 'Lan', revision: 5, role: 'recipient' as const };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useMyMapsPanelPresenter(), { wrapper }) };
}

beforeEach(() => {
  [listMaps, getMap, createMap, updateMap, deleteMap, listUploads, copyMap].forEach((m) => m.mockReset());
  resetMyMapsStore();
  resetTableStore();
  resetShell();
  resetToasts();
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
    const { result, client } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.askDelete('m1'));
    expect(deleteMap).not.toHaveBeenCalled();
    expect(result.current.pendingDelete).toBe(true);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteMap).toHaveBeenCalledWith('m1', 3);
    expect(result.current.pendingDelete).toBe(false);
    // Đã dùng is read again.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.uploads });
  });

  it('a layer row carries the truncation count of its last read', async () => {
    const layer = { id: 'l1', kind: 'free', title: 'Điểm', position: 0, style: {}, geometryType: 'point', fields: [], layerKey: null, draftId: null, featureCount: 9000, raster: null };
    getMap.mockImplementation(async (id: string) => ({ ...(id === 'm1' ? MINE : SHARED), layers: id === 'm1' ? [layer] : [] }));
    expandMap('m1');
    const { result } = setup();
    await waitFor(() => expect(result.current.own[0].layers).toHaveLength(1));
    expect(result.current.own[0].layers![0].truncated).toBeNull();
    act(() => setTruncated('l1', 5000));
    expect(result.current.own[0].layers![0].truncated).toBe(5000);
  });

  it('the list and a shared map’s detail are read again on window focus; an own map’s detail is not', async () => {
    expandMap('m1');
    expandMap('m2');
    const { result } = setup();
    await waitFor(() => expect(result.current.own[0].layers).toEqual([]));
    await waitFor(() => expect(result.current.shared[0].layers).toEqual([]));
    listMaps.mockClear();
    getMap.mockClear();
    try {
      act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
      await waitFor(() => expect(listMaps).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getMap).toHaveBeenCalledWith('m2'));
      expect(getMap).not.toHaveBeenCalledWith('m1');
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('a recipient gets no rename or delete actions', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.own[0].canWrite).toBe(true);
    expect(result.current.shared[0].canWrite).toBe(false);
  });

  it('rename sends the detail revision, not the list revision', async () => {
    getMap.mockImplementation(async (id: string) => ({ ...(id === 'm1' ? MINE : SHARED), revision: id === 'm1' ? 7 : 5, layers: [] }));
    updateMap.mockResolvedValue({ ...MINE, title: 'Mới', revision: 8, layers: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openRename('m1'));
    act(() => result.current.setTitle('Mới'));
    await act(async () => { await result.current.submit(); });
    expect(updateMap).toHaveBeenCalledWith('m1', { title: 'Mới', expectedRevision: 7 });
    expect(result.current.dialog.open).toBe(false);
  });

  it('MAP_CHANGED on rename keeps the typed title and shows the copy', async () => {
    updateMap.mockRejectedValue(new ApiError(409, 'MAP_CHANGED', 'x'));
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openRename('m1'));
    act(() => result.current.setTitle('Tên gõ dở'));
    await act(async () => { await result.current.submit(); });
    expect(result.current.dialog.open).toBe(true);
    expect(result.current.dialog.title).toBe('Tên gõ dở');
    expect(result.current.dialog.error).toBe(MAP_CHANGED_COPY);
  });

  it('MAP_CHANGED on delete shows the copy', async () => {
    deleteMap.mockRejectedValue(new ApiError(409, 'MAP_CHANGED', 'x'));
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.askDelete('m1'));
    await act(async () => { await result.current.confirmDelete(); });
    expect(result.current.pendingDelete).toBe(true);
    expect(result.current.deleteError).toBe(MAP_CHANGED_COPY);
  });

  it('a map gone on delete leaves the list', async () => {
    deleteMap.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản đồ.'));
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    listMaps.mockResolvedValue({ mine: [], sharedWithMe: [SHARED] });
    act(() => result.current.askDelete('m1'));
    await act(async () => { await result.current.confirmDelete(); });
    expect(result.current.pendingDelete).toBe(false);
    await waitFor(() => expect(result.current.own).toEqual([]));
    expect(getToasts().map((t) => t.title)).toContain('Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.');
  });

  it('Tạo bản sao adds the copy to Của tôi, expanded, with a toast', async () => {
    const copy = { ...MINE, id: 'm9', title: 'Sông Hàn (bản sao)', revision: 1 };
    copyMap.mockResolvedValue({ ...copy, layers: [] });
    const { result, client } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    listMaps.mockResolvedValue({ mine: [MINE, copy], sharedWithMe: [SHARED] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => { await result.current.copy('m2'); });
    expect(copyMap).toHaveBeenCalledWith('m2');
    // Đã dùng is read again: the copy counts in it.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.uploads });
    await waitFor(() => expect(result.current.own.map((c) => c.id)).toEqual(['m1', 'm9']));
    expect(getMyMaps().expanded.has('m9')).toBe(true);
    expect(getToasts().map((t) => t.title)).toContain('Đã tạo bản sao “Sông Hàn (bản sao)”.');
  });

  it('a failed copy shows the API message and adds nothing', async () => {
    copyMap.mockRejectedValue(new ApiError(413, 'QUOTA', 'Hết dung lượng.'));
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.copy('m2'); });
    expect(getToasts().map((t) => t.title)).toContain('Hết dung lượng.');
    expect(result.current.own.map((c) => c.id)).toEqual(['m1']);
  });

  it('openLayerTable expands the map and opens the table of that layer', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.openLayerTable('m1', 'l7'); });
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    expect(getTableState().open).toEqual({ mapId: 'm1', layerId: 'l7' });
  });

  it('opening the table closes Biên tập', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => openTool('edit'));
    act(() => { result.current.openLayerTable('m1', 'l7'); });
    expect(getShell().tool).toBeNull();
    // Another tool is left alone.
    act(() => openTool('measure'));
    act(() => { result.current.openLayerTable('m1', 'l8'); });
    expect(getShell().tool).toBe('measure');
  });
});
