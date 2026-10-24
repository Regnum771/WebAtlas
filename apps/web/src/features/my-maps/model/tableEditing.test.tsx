import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LayerQueryResponse, LayerSummary } from '../api/workspace.api';

// The table and its editing together, as OpenLayerTable (index.tsx) composes them.

const getMap = vi.fn();
const listMaps = vi.fn();
const queryLayer = vi.fn();
const updateFeature = vi.fn();
const removeFeature = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  listMaps: () => listMaps(),
  queryLayer: (...a: unknown[]) => queryLayer(...a),
  updateFeature: (...a: unknown[]) => updateFeature(...a),
  removeFeature: (...a: unknown[]) => removeFeature(...a),
}));
const MAP = { on: vi.fn(), un: vi.fn() };
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: MAP }) }));
const ol = vi.hoisted(() => ({
  ringFeature: vi.fn(),
  clearRing: vi.fn(),
  refreshPersonalLayer: vi.fn(),
}));
vi.mock('./personalLayers', () => ({
  PERSONAL_READ_LIMIT: 5000,
  viewExtent4326: () => [100, 10, 101, 11],
  watchViewExtent4326: () => () => undefined,
  ringFeature: (...a: unknown[]) => ol.ringFeature(...a),
  clearRing: (...a: unknown[]) => ol.clearRing(...a),
  fitToExtent4326: vi.fn(),
  ringExtent4326: () => null,
  refreshPersonalLayer: (...a: unknown[]) => ol.refreshPersonalLayer(...a),
  // The map's loaded source does not hold the feature (its layer is reading again).
  personalFeature: () => null,
}));
vi.mock('./personalStyle', () => ({ symbolDataUrl: () => '', editCopyKey: () => null }));
vi.mock('../../dictionary', async () => {
  const shared = await vi.importActual<typeof import('@webatlas/shared')>('@webatlas/shared');
  return { useDictionary: () => shared.DICTIONARY };
});
vi.mock('../../map/model/mapEditing', () => ({
  useMapEditing: () => ({ startDraw: vi.fn(), cancelDraw: vi.fn(), startModifyFeature: vi.fn(), cancelModify: vi.fn() }),
}));

import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { useTablePresenter } from './useTablePresenter';
import { usePersonalEditingPresenter } from './usePersonalEditingPresenter';
import { keys } from './queries';
import { resetMyMapsStore } from './myMaps.store';
import { getTableState, openTable, resetTableStore, select, setFilter } from './table.store';

const LAYER: LayerSummary = {
  id: 'l1', kind: 'free', title: 'Điểm đo', position: 0, style: {}, geometryType: 'point',
  fields: [{ name: 'loai', type: 'text' }], layerKey: null, draftId: null, featureCount: 3, raster: null,
};
const OTHER: LayerSummary = { ...LAYER, id: 'l2', title: 'Khác' };
const SUMMARY = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 1,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 2, role: 'owner' as const,
};
const DETAIL = { ...SUMMARY, layers: [LAYER, OTHER] };

/** The layer's features; a query filters them on `loai` (eq) and locates by id. */
let features: { id: string; loai: string }[];
function answer(body: { conditions: { field: string; value?: string }[]; locate?: string }): LayerQueryResponse {
  const wanted = body.conditions.find((c) => c.field === 'loai')?.value;
  const rows = features.filter((f) => wanted === undefined || f.loai === wanted);
  const at = body.locate === undefined ? -1 : rows.findIndex((f) => f.id === body.locate);
  return {
    columns: [{ name: 'loai', type: 'text' }],
    total: features.length,
    matched: rows.length,
    rows: rows.map((f) => ({ id: f.id, properties: { loai: f.loai }, bbox: [108, 16, 108, 16] })),
    position: body.locate === undefined || at < 0 ? null : at,
  };
}

let qc: QueryClient;
function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => {
    const table = useTablePresenter();
    const editing = usePersonalEditingPresenter(table.selected);
    return { table, editing };
  }, { wrapper });
}
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  features = [{ id: '1', loai: 'cong' }, { id: '2', loai: 'cong' }, { id: '3', loai: 'dap' }];
  getMap.mockReset().mockResolvedValue(DETAIL);
  listMaps.mockReset().mockResolvedValue({ mine: [SUMMARY], sharedWithMe: [] });
  queryLayer.mockReset().mockImplementation((_m: string, _l: string, body: Parameters<typeof answer>[0]) => Promise.resolve(answer(body)));
  updateFeature.mockReset();
  removeFeature.mockReset();
  ol.ringFeature.mockClear();
  ol.clearRing.mockClear();
  ol.refreshPersonalLayer.mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetMyMapsStore();
  resetToasts();
  resetTableStore();
  openTable('m1', 'l1');
});
afterEach(() => { vi.useRealTimers(); });

describe('editing from the table', () => {
  it('a saved feature that no longer matches stays open with the note', async () => {
    const { result } = setup();
    act(() => setFilter({ conditions: [{ field: 'loai', op: 'eq', value: 'cong' }] }));
    await flush(400);
    await flush(10);
    expect(queryLayer.mock.calls.at(-1)![2].conditions).toEqual([{ field: 'loai', op: 'eq', value: 'cong' }]);
    expect(result.current.table.rows.map((r) => r.id)).toEqual(['1', '2']);
    act(() => result.current.table.selectRow('2'));
    await flush(10);
    expect(result.current.editing.step).toBe('form');
    expect(result.current.editing.freeValues).toEqual({ loai: 'cong' });

    // Changing `loai` while the table filters on it.
    updateFeature.mockImplementation(async () => {
      features = features.map((f) => (f.id === '2' ? { ...f, loai: 'dap' } : f));
      return { feature: { id: '2' }, revision: 2 };
    });
    act(() => result.current.editing.setFreeValue('loai', 'dap'));
    await act(async () => { await result.current.editing.submitFree(); });
    await flush(10);
    await flush(10);

    // The layer reloads on the map, the page is read again and the row leaves it.
    expect(ol.refreshPersonalLayer).toHaveBeenCalledWith(MAP, 'l1');
    expect(result.current.table.rows.map((r) => r.id)).toEqual(['1']);
    // The saved feature was located again: the filter hides it now.
    const located = queryLayer.mock.calls.filter((c) => (c[2] as { locate?: string }).locate === '2');
    expect(located.length).toBeGreaterThan(0);
    expect(result.current.table.selectedOutsideFilter).toBe(true);
    // It stays selected, ringed and open, with what was saved.
    expect(getTableState().selectedId).toBe('2');
    expect(ol.ringFeature).toHaveBeenLastCalledWith(MAP, 'l1', '2');
    expect(result.current.editing.step).toBe('form');
    expect(result.current.editing.freeValues).toEqual({ loai: 'dap' });
  });

  it('a saved feature that still matches stays selected, with no note', async () => {
    updateFeature.mockImplementation(async () => {
      features = features.map((f) => (f.id === '1' ? { ...f, loai: 'cong 2' } : f));
      return { feature: { id: '1' }, revision: 2 };
    });
    const { result } = setup();
    await flush(10);
    act(() => result.current.table.selectRow('1'));
    await flush(10);
    act(() => result.current.editing.setFreeValue('loai', 'cong 2'));
    await act(async () => { await result.current.editing.submitFree(); });
    await flush(10);
    await flush(10);
    expect(result.current.table.selectedOutsideFilter).toBe(false);
    expect(result.current.table.rows[0].properties).toEqual({ loai: 'cong 2' });
    expect(result.current.editing.freeValues).toEqual({ loai: 'cong 2' });
    expect(getTableState().selectedId).toBe('1');
  });

  it('deleting clears the selection and refreshes the page', async () => {
    removeFeature.mockImplementation(async () => {
      features = features.filter((f) => f.id !== '3');
      return { revision: 2 };
    });
    const { result } = setup();
    await flush(10);
    act(() => result.current.table.selectRow('3'));
    await flush(10);
    expect(result.current.editing.step).toBe('form');
    const reads = queryLayer.mock.calls.length;
    act(() => result.current.editing.requestDelete());
    await act(async () => { await result.current.editing.confirmDelete(); });
    await flush(10);
    expect(getTableState().selectedId).toBeNull();
    expect(result.current.editing.step).toBeNull();
    expect(ol.clearRing).toHaveBeenCalled();
    expect(queryLayer.mock.calls.length).toBeGreaterThan(reads);
    expect(result.current.table.rows.map((r) => r.id)).toEqual(['1', '2']);
    expect(result.current.table.header.total).toBe(2);
  });

  it('the table closes when its map is gone or its layer deleted', async () => {
    const { result } = setup();
    await flush(10);
    act(() => result.current.table.selectRow('1'));
    await flush(10);
    ol.clearRing.mockClear();

    // The layer deleted from ⚙: the map's detail no longer lists it. No message.
    act(() => { qc.setQueryData(keys.map('m1'), { ...DETAIL, layers: [OTHER] }); });
    await flush(10);
    expect(getTableState().open).toBeNull();
    expect(getTableState().selectedId).toBeNull();
    expect(ol.clearRing).toHaveBeenCalled();
    expect(getToasts()).toEqual([]);

    // The map gone (revoked or deleted): it left the lists.
    act(() => { qc.setQueryData(keys.map('m1'), DETAIL); openTable('m1', 'l2'); select('1'); });
    await flush(10);
    expect(getTableState().open).toEqual({ mapId: 'm1', layerId: 'l2' });
    act(() => { qc.setQueryData(keys.maps, { mine: [], sharedWithMe: [] }); });
    await flush(10);
    expect(getTableState().open).toBeNull();
    expect(getTableState().selectedId).toBeNull();
  });
});
