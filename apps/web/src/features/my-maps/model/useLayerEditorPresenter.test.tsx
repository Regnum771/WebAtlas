import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const getMap = vi.fn();
const listMaps = vi.fn();
const addFreeLayer = vi.fn();
const addEditCopy = vi.fn();
const updateLayer = vi.fn();
const removeLayer = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  listMaps: () => listMaps(),
  addFreeLayer: (id: string, i: unknown) => addFreeLayer(id, i),
  addEditCopy: (id: string, i: unknown) => addEditCopy(id, i),
  updateLayer: (id: string, l: string, i: unknown) => updateLayer(id, l, i),
  removeLayer: (id: string, l: string, r: number) => removeLayer(id, l, r),
}));
const refreshPersonalLayer = vi.fn();
vi.mock('./personalLayers', () => ({ refreshPersonalLayer: (...a: unknown[]) => refreshPersonalLayer(...a) }));
const MAP = { tag: 'ol-map' };
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: MAP }) }));

import { ApiError } from '../../../shared/api/apiClient';
import { useLayerEditorPresenter } from './useLayerEditorPresenter';
import { MAP_CHANGED_COPY, useMapDetail } from './queries';
import { getMyMaps, resetMyMapsStore } from './myMaps.store';

const layer = (over: Record<string, unknown>) => ({
  id: 'l', kind: 'free', title: 'Lớp', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 0, raster: null, ...over,
});
const DETAIL = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 4,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 2, role: 'owner',
  layers: [layer({ id: 'a', position: 0 }), layer({ id: 'b', position: 1 })],
};

let client: QueryClient;
function setup() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  // The panel keeps the map's detail observed while its card is open, so a write's refetch lands in the cache.
  return renderHook(() => { useMapDetail('m1'); return useLayerEditorPresenter('m1'); }, { wrapper });
}

beforeEach(() => {
  [getMap, listMaps, addFreeLayer, addEditCopy, updateLayer, removeLayer, refreshPersonalLayer].forEach((m) => m.mockReset());
  resetMyMapsStore();
  getMap.mockResolvedValue(DETAIL);
  listMaps.mockResolvedValue({ mine: [], sharedWithMe: [] });
  updateLayer.mockResolvedValue({ layer: layer({}), revision: 5 });
});
afterEach(() => { vi.useRealTimers(); });

describe('useLayerEditorPresenter', () => {
  it('creating a drawn layer sends its fields and turns it on', async () => {
    addFreeLayer.mockResolvedValue({ layer: layer({ id: 'new' }), revision: 5 });
    const { result } = setup();
    let error: string | null = 'x';
    await act(async () => {
      error = await result.current.createDrawn({
        title: ' Điểm ngập ', geometryType: 'point',
        fields: [{ name: 'Độ sâu', type: 'number' }, { name: '  ', type: 'text' }],
      });
    });
    expect(error).toBeNull();
    expect(addFreeLayer).toHaveBeenCalledWith('m1', {
      title: 'Điểm ngập', geometryType: 'point', fields: [{ name: 'Độ sâu', type: 'number' }], expectedRevision: 4,
    });
    expect(getMyMaps().layers.new).toEqual(expect.objectContaining({ visible: true }));
  });

  it('an edit copy is created from the chosen official layer', async () => {
    addEditCopy.mockResolvedValue({ layer: layer({ id: 'copy', kind: 'edit_copy' }), revision: 5 });
    const { result } = setup();
    await act(async () => { await result.current.createEditCopy('rivers'); });
    expect(addEditCopy).toHaveBeenCalledWith('m1', { layerKey: 'rivers', expectedRevision: 4 });
    expect(getMyMaps().layers.copy.visible).toBe(true);
  });

  it('renaming a field sends from and the new name, then reloads the layer', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.saveFields('a', [{ name: 'Sâu', type: 'number', from: 'Độ sâu' }, { name: 'Ghi chú', type: 'text' }]);
    });
    expect(updateLayer).toHaveBeenCalledWith('m1', 'a', {
      fields: [{ name: 'Sâu', type: 'number', from: 'Độ sâu' }, { name: 'Ghi chú', type: 'text' }],
      expectedRevision: 4,
    });
    expect(refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'a');
  });

  it('the API message of a refused fields change is returned as it comes', async () => {
    updateLayer.mockRejectedValue(new ApiError(400, 'VALIDATION', 'Lớp nhập từ tệp giữ nguyên các cột gốc.'));
    const { result } = setup();
    let error: string | null = null;
    await act(async () => { error = await result.current.saveFields('a', []); });
    expect(error).toBe('Lớp nhập từ tệp giữ nguyên các cột gốc.');
  });

  it('MAP_CHANGED returns the copy so the form keeps what was typed', async () => {
    addFreeLayer.mockRejectedValue(new ApiError(409, 'MAP_CHANGED', 'stale'));
    const { result } = setup();
    let error: string | null = null;
    await act(async () => { error = await result.current.createDrawn({ title: 'X', geometryType: 'line', fields: [] }); });
    expect(error).toBe(MAP_CHANGED_COPY);
  });

  it('style changes are saved once after 500 ms of quiet', async () => {
    const { result } = setup();
    await act(async () => { await result.current.rename('a', 'Tên mới'); });
    updateLayer.mockClear();
    vi.useFakeTimers();
    act(() => { result.current.setStyle('a', { color: '#112233' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    act(() => { result.current.setStyle('a', { width: 5 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(updateLayer).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(updateLayer).toHaveBeenCalledTimes(1);
    expect(updateLayer).toHaveBeenCalledWith('m1', 'a', {
      style: { color: '#112233', width: 5, fillOpacity: 0.25, pointRadius: 6 }, expectedRevision: 4,
    });
  });

  it('move swaps with the neighbour position', async () => {
    const { result } = setup();
    await act(async () => { await result.current.rename('a', 'A'); });
    updateLayer.mockClear();
    await act(async () => { await result.current.move('b', 'up'); });
    expect(updateLayer).toHaveBeenCalledWith('m1', 'b', { position: 0, expectedRevision: 4 });
  });

  it('remove deletes the layer with the revision of the last read', async () => {
    removeLayer.mockResolvedValue({ revision: 5 });
    const { result } = setup();
    await act(async () => { await result.current.remove('a'); });
    expect(removeLayer).toHaveBeenCalledWith('m1', 'a', 4);
  });

  /** A server that keeps a revision and the layers' order, and refuses a stale revision. */
  function fakeServer(ids: string[]) {
    const state = { revision: 4, order: ids, styles: {} as Record<string, unknown> };
    const snapshot = () => ({
      ...DETAIL, revision: state.revision,
      layers: state.order.map((id, position) => layer({ id, position, style: state.styles[id] ?? {} })),
    });
    getMap.mockImplementation(async () => snapshot());
    updateLayer.mockImplementation(async (_m: string, id: string, input: { expectedRevision: number; position?: number; style?: unknown }) => {
      if (input.expectedRevision !== state.revision) throw new ApiError(409, 'MAP_CHANGED', 'stale');
      if (input.position !== undefined) {
        const next = state.order.filter((x) => x !== id);
        next.splice(input.position, 0, id);
        state.order = next;
      }
      if (input.style) state.styles[id] = input.style;
      state.revision += 1;
      return { layer: layer({ id, style: state.styles[id] ?? {} }), revision: state.revision };
    });
    return state;
  }

  it('two quick moves both succeed with consecutive revisions', async () => {
    const server = fakeServer(['a', 'b', 'c']);
    const { result } = setup();
    let results: (string | null)[] = [];
    await act(async () => {
      results = await Promise.all([result.current.move('c', 'up'), result.current.move('c', 'up')]);
    });
    expect(results).toEqual([null, null]);
    expect(updateLayer.mock.calls.map((c) => c[2].expectedRevision)).toEqual([4, 5]);
    expect(server.order).toEqual(['c', 'a', 'b']);
  });

  it('a style save queued behind a rename uses the rename revision', async () => {
    fakeServer(['a', 'b']);
    const { result } = setup();
    await act(async () => { await result.current.rename('b', 'B'); });
    updateLayer.mockClear();
    vi.useFakeTimers();
    let renamed: Promise<string | null> = Promise.resolve(null);
    act(() => { result.current.setStyle('a', { width: 4 }); });
    act(() => { renamed = result.current.rename('b', 'B2'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await renamed; });
    expect(updateLayer.mock.calls.map((c) => c[2].expectedRevision)).toEqual([5, 6]);
  });

  it('a landed style save does not overwrite a newer pending style', async () => {
    fakeServer(['a']);
    const { result } = setup();
    await act(async () => { await result.current.rename('a', 'A'); });
    vi.useFakeTimers();
    act(() => { result.current.setStyle('a', { width: 3 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    // The first save is on its way; a newer change arrives before it lands.
    act(() => { result.current.setStyle('a', { width: 6 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const cached = client.getQueryData<{ layers: { style: { width: number } }[] }>(['ws', 'map', 'm1']);
    expect(cached?.layers[0].style.width).toBe(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(updateLayer).toHaveBeenLastCalledWith('m1', 'a', expect.objectContaining({ style: expect.objectContaining({ width: 6 }) }));
  });
});
