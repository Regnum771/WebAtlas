import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LayerQueryResponse, LayerSummary } from '../api/workspace.api';

const getMap = vi.fn();
const queryLayer = vi.fn();
const listMaps = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  listMaps: () => listMaps(),
  queryLayer: (...a: unknown[]) => queryLayer(...a),
}));
const session = vi.hoisted(() => ({ status: 'authenticated' as string }));
vi.mock('../../../entities/session/model/session.store', () => ({ useSession: () => ({ status: session.status }) }));
const MAP = { on: vi.fn(), un: vi.fn() };
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: MAP }) }));
/** The extent watcher's callback: a test plays moveend events through it. */
const view = vi.hoisted(() => ({ onChange: null as null | ((extent: [number, number, number, number]) => void) }));
const ol = vi.hoisted(() => ({
  ringFeature: vi.fn(),
  clearRing: vi.fn(),
  fitToExtent4326: vi.fn(),
  ringExtent4326: vi.fn((): [number, number, number, number] | null => null),
}));
vi.mock('./personalLayers', () => ({
  viewExtent4326: () => [100, 10, 101, 11],
  watchViewExtent4326: (_map: unknown, onChange: (extent: [number, number, number, number]) => void) => {
    view.onChange = onChange;
    return () => { view.onChange = null; };
  },
  ringFeature: (...a: unknown[]) => ol.ringFeature(...a),
  clearRing: (...a: unknown[]) => ol.clearRing(...a),
  fitToExtent4326: (...a: unknown[]) => ol.fitToExtent4326(...a),
  ringExtent4326: (...a: unknown[]) => ol.ringExtent4326(...(a as [])),
  personalFeature: () => null,
}));
const symbolDataUrl = vi.fn(
  (layer: LayerSummary, properties: Record<string, unknown>, geometryType: string) =>
    `data:image/png;base64,${layer.id}-${geometryType}-${String(properties.ten)}`,
);
vi.mock('./personalStyle', () => ({
  symbolDataUrl: (layer: LayerSummary, properties: Record<string, unknown>, geometryType: string) =>
    symbolDataUrl(layer, properties, geometryType),
}));

import { useResetTableOnSignOut, useTablePresenter } from './useTablePresenter';
import { getTableState, openTable, relocate, resetTableStore, select, setFilter } from './table.store';

const LAYER: LayerSummary = {
  id: 'l1', kind: 'free', title: 'Điểm đo', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 151, raster: null,
};
const DETAIL = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 1,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 1, role: 'owner', layers: [LAYER],
};
/** Row n (1-based) sits at longitude 108 + n / 1000. */
const bboxOf = (n: number): [number, number, number, number] => [108 + n / 1000, 16, 108 + n / 1000, 16];
/** Ids 1..matched in order; `locate` finds an id among them (its position), else null. */
const answer = (matched: number, offset = 0, locate?: string): LayerQueryResponse => ({
  columns: [{ name: 'ten', type: 'text' }, { name: 'cong_suat', type: 'number' }],
  total: 151,
  matched,
  rows: Array.from({ length: Math.min(100, matched - offset) }, (_, i) => ({
    id: String(offset + i + 1),
    properties: { ten: `Trạm ${offset + i + 1}`, cong_suat: i, ghi_chu: null },
    bbox: bboxOf(offset + i + 1),
  })),
  position: locate !== undefined && Number(locate) >= 1 && Number(locate) <= matched ? Number(locate) - 1 : null,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return Object.assign(renderHook(() => useTablePresenter(), { wrapper }), { qc });
}
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  getMap.mockReset().mockResolvedValue(DETAIL);
  listMaps.mockReset().mockResolvedValue({ mine: [DETAIL], sharedWithMe: [] });
  session.status = 'authenticated';
  queryLayer.mockReset().mockImplementation((_m: string, _l: string, body: { offset: number; locate?: string }) =>
    Promise.resolve(answer(250, body.offset, body.locate)));
  symbolDataUrl.mockClear();
  ol.ringFeature.mockClear();
  ol.clearRing.mockClear();
  ol.fitToExtent4326.mockClear();
  ol.ringExtent4326.mockReset().mockReturnValue(null);
  resetTableStore();
  openTable('m1', 'l1');
});
afterEach(() => { vi.useRealTimers(); });

describe('useTablePresenter', () => {
  it('columns and rows come from the query; the symbol cell is filled', async () => {
    const { result } = setup();
    await flush(10);
    expect(result.current.header).toEqual({ title: 'Điểm đo', total: 151, matched: 250 });
    expect(result.current.isOwner).toBe(true);
    expect(result.current.columns).toEqual([
      { name: 'ten', label: 'ten', type: 'text' },
      { name: 'cong_suat', label: 'cong_suat', type: 'number' },
    ]);
    expect(result.current.rows).toHaveLength(100);
    const [first] = result.current.rows;
    expect(first).toMatchObject({ id: '1', cells: ['Trạm 1', '0'], symbol: 'data:image/png;base64,l1-point-Trạm 1' });
    expect(symbolDataUrl).toHaveBeenCalledWith(LAYER, first.properties, 'point');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('clicking a header cycles ascending, descending, off', async () => {
    const { result } = setup();
    await flush(10);
    act(() => result.current.toggleSort('ten'));
    expect(result.current.sort).toEqual({ field: 'ten', dir: 'asc' });
    act(() => result.current.toggleSort('ten'));
    expect(result.current.sort).toEqual({ field: 'ten', dir: 'desc' });
    act(() => result.current.toggleSort('ten'));
    expect(result.current.sort).toBeNull();
    act(() => result.current.toggleSort('ten'));
    act(() => result.current.toggleSort('cong_suat'));
    expect(result.current.sort).toEqual({ field: 'cong_suat', dir: 'asc' });
    await flush(10);
    expect(queryLayer.mock.calls.at(-1)![2]).toMatchObject({ sort: { field: 'cong_suat', dir: 'asc' }, offset: 0 });
  });

  it('Sau and Trước page by 100 and stop at the ends', async () => {
    const { result } = setup();
    await flush(10);
    expect(result.current.page).toEqual({ index: 0, size: 100, from: 1, to: 100, canPrev: false, canNext: true });
    act(() => result.current.prev());
    expect(getTableState().byLayer.l1.page).toBe(0);
    act(() => result.current.next());
    await flush(10);
    expect(queryLayer.mock.calls.at(-1)![2]).toMatchObject({ offset: 100, limit: 100 });
    expect(result.current.page).toMatchObject({ index: 1, from: 101, to: 200, canPrev: true, canNext: true });
    act(() => result.current.next());
    await flush(10);
    expect(result.current.page).toMatchObject({ index: 2, from: 201, to: 250, canPrev: true, canNext: false });
    const calls = queryLayer.mock.calls.length;
    act(() => result.current.next());
    await flush(10);
    expect(getTableState().byLayer.l1.page).toBe(2);
    expect(queryLayer.mock.calls.length).toBe(calls);
    act(() => result.current.prev());
    act(() => result.current.prev());
    act(() => result.current.prev());
    await flush(10);
    expect(result.current.page).toMatchObject({ index: 0, from: 1, to: 100, canPrev: false });
  });

  it("conditions offer only the operators of their column's type", async () => {
    const { result } = setup();
    await flush(10);
    const labels = (i: number) => result.current.conditions[i].ops.map((o) => o.label);

    act(() => result.current.addCondition());
    expect(result.current.filter.conditions).toEqual([{ field: 'ten', op: 'contains', value: '' }]);
    expect(labels(0)).toEqual(['chứa', 'bằng', 'khác', 'trống', 'không trống']);

    // A number column: no `chứa`; the text-only operator falls back to the first one it offers.
    act(() => result.current.updateCondition(0, { field: 'cong_suat' }));
    expect(result.current.filter.conditions[0]).toMatchObject({ field: 'cong_suat', op: 'eq' });
    expect(labels(0)).toEqual(['bằng', 'khác', '<', '≤', '>', '≥', 'trống', 'không trống']);
    act(() => result.current.updateCondition(0, { op: 'gt', value: '50' }));
    expect(result.current.conditions[0]).toMatchObject({
      field: 'cong_suat', fieldLabel: 'cong_suat', op: 'gt', opLabel: '>', value: '50', needsValue: true,
    });
    await flush(310);
    expect(queryLayer.mock.calls.at(-1)![2].conditions).toEqual([{ field: 'cong_suat', op: 'gt', value: '50' }]);

    // An operator without a value drops it; the match choice and removal apply.
    act(() => result.current.updateCondition(0, { op: 'empty' }));
    expect(result.current.filter.conditions[0]).toEqual({ field: 'cong_suat', op: 'empty' });
    expect(result.current.conditions[0].needsValue).toBe(false);
    act(() => result.current.setMatch('any'));
    expect(result.current.filter.match).toBe('any');
    act(() => result.current.removeCondition(0));
    expect(result.current.filter.conditions).toEqual([]);
  });

  it('search, in view and close reach the store', async () => {
    const { result } = setup();
    await flush(10);
    act(() => result.current.setSearch('trạm'));
    expect(result.current.filter.q).toBe('trạm');
    act(() => result.current.setInView(true));
    await flush(310);
    expect(queryLayer.mock.calls.at(-1)![2]).toMatchObject({ q: 'trạm', bbox: [100, 10, 101, 11] });
    act(() => result.current.close());
    expect(getTableState().open).toBeNull();
  });

  it('dragging the dock with in view on sends one query after the drag settles', async () => {
    const { result } = setup();
    await flush(10);
    act(() => result.current.setInView(true));
    await flush(10);
    const before = queryLayer.mock.calls.length;
    expect(queryLayer.mock.calls.at(-1)![2].bbox).toEqual([100, 10, 101, 11]);
    // A drag resizes the map on every frame, and OpenLayers ends a move after each resize.
    for (let i = 1; i <= 60; i += 1) {
      act(() => view.onChange!([100, 10 - i * 0.01, 101, 11]));
      await flush(16);
    }
    expect(queryLayer.mock.calls.length).toBe(before);
    await flush(300);
    expect(queryLayer.mock.calls.length).toBe(before + 1);
    expect(queryLayer.mock.calls.at(-1)![2].bbox).toEqual([100, 9.4, 101, 11]);
    await flush(1000);
    expect(queryLayer.mock.calls.length).toBe(before + 1);
  });

  it('zooming in with in view on past the last page moves to the last page that exists', async () => {
    const SMALL: [number, number, number, number] = [100.4, 10.4, 100.6, 10.6];
    queryLayer.mockImplementation((_m: string, _l: string, body: { offset: number; bbox?: number[] }) =>
      Promise.resolve(answer(JSON.stringify(body.bbox) === JSON.stringify(SMALL) ? 150 : 250, body.offset)));
    const { result } = setup();
    await flush(10);
    act(() => result.current.setInView(true));
    await flush(10);
    act(() => result.current.next());
    await flush(10);
    act(() => result.current.next());
    await flush(10);
    expect(result.current.page).toMatchObject({ index: 2, from: 201, to: 250 });
    // Zoomed in: 150 features remain in view, so page 3 no longer exists.
    act(() => view.onChange!(SMALL));
    await flush(310);
    await flush(10);
    expect(getTableState().byLayer.l1.page).toBe(1);
    expect(result.current.page).toEqual({ index: 1, size: 100, from: 101, to: 150, canPrev: true, canNext: false });
    expect(queryLayer.mock.calls.at(-1)![2]).toMatchObject({ offset: 100, bbox: SMALL });
    expect(result.current.rows).toHaveLength(50);
  });

  it('deleting the only row on the last page moves to the page before', async () => {
    let count = 201;
    queryLayer.mockImplementation((_m: string, _l: string, body: { offset: number }) =>
      Promise.resolve(answer(count, body.offset)));
    const { result, qc } = setup();
    await flush(10);
    act(() => result.current.next());
    await flush(10);
    act(() => result.current.next());
    await flush(10);
    expect(result.current.page).toMatchObject({ index: 2, from: 201, to: 201 });
    // A delete: the write invalidates the map's tables (useMapWrite) and the row is gone.
    count = 200;
    await act(async () => { await qc.invalidateQueries({ queryKey: ['ws', 'table', 'm1'] }); });
    await flush(10);
    await flush(10);
    expect(getTableState().byLayer.l1.page).toBe(1);
    expect(result.current.page).toEqual({ index: 1, size: 100, from: 101, to: 200, canPrev: true, canNext: false });
    expect(result.current.rows).toHaveLength(100);
  });
});

describe('useTablePresenter: selection', () => {
  const located = () => queryLayer.mock.calls.filter((c) => (c[2] as { locate?: string }).locate !== undefined);

  it('a row click selects and rings without moving the map', async () => {
    const { result, unmount } = setup();
    await flush(10);
    act(() => result.current.selectRow('5'));
    expect(getTableState().selectedId).toBe('5');
    expect(result.current.selectedId).toBe('5');
    expect(ol.ringFeature).toHaveBeenLastCalledWith(MAP, 'l1', '5');
    await flush(10);
    expect(ol.fitToExtent4326).not.toHaveBeenCalled();
    // The row is on the page: nothing to locate.
    expect(located()).toEqual([]);
    expect(result.current.selectedOutsideFilter).toBe(false);
    // The table closing takes the ring off.
    unmount();
    expect(ol.clearRing).toHaveBeenCalledWith(MAP);
  });

  it("a map click on the table's layer rings its row; one on the page is not located", async () => {
    const { result } = setup();
    await flush(10);
    // As usePersonalPopupPresenter does for a click on the table's layer.
    act(() => select('42'));
    await flush(10);
    expect(ol.ringFeature).toHaveBeenLastCalledWith(MAP, 'l1', '42');
    expect(result.current.selectedId).toBe('42');
    expect(located()).toEqual([]);
    expect(result.current.page.index).toBe(0);
  });

  it('a feature on another page is located and its page shown', async () => {
    const { result } = setup();
    await flush(10);
    act(() => select('180'));
    await flush(10);
    expect(located()).toHaveLength(1);
    expect(located()[0][2]).toMatchObject({ locate: '180', offset: 0 });
    await flush(10);
    // Position 179 is on the second page (floor(179 / 100) = 1).
    expect(getTableState().byLayer.l1.page).toBe(1);
    expect(result.current.page).toMatchObject({ index: 1, from: 101, to: 200 });
    expect(queryLayer.mock.calls.at(-1)![2]).toMatchObject({ offset: 100 });
    expect(queryLayer.mock.calls.at(-1)![2].locate).toBeUndefined();
    expect(result.current.rows.some((r) => r.id === '180')).toBe(true);
    expect(result.current.selectedOutsideFilter).toBe(false);
    expect(ol.ringFeature).toHaveBeenLastCalledWith(MAP, 'l1', '180');

    // Paging away keeps the selection and does not jump back to it.
    act(() => result.current.next());
    await flush(10);
    expect(result.current.page.index).toBe(2);
    expect(located()).toHaveLength(1);
    expect(getTableState().selectedId).toBe('180');
  });

  it('a feature hidden by the filter shows the note', async () => {
    const { result } = setup();
    await flush(10);
    act(() => select('999'));
    await flush(10);
    await flush(10);
    expect(located()).toHaveLength(1);
    expect(result.current.selectedOutsideFilter).toBe(true);
    // The page stays where it was; the feature stays selected and ringed.
    expect(result.current.page.index).toBe(0);
    expect(getTableState().selectedId).toBe('999');
    expect(ol.ringFeature).toHaveBeenLastCalledWith(MAP, 'l1', '999');
    // Selecting a row on the page clears the note.
    act(() => result.current.selectRow('3'));
    expect(result.current.selectedOutsideFilter).toBe(false);
  });

  it("Phóng tới fits the selection's bbox", async () => {
    const { result } = setup();
    await flush(10);
    // Nothing selected: every row on the page.
    expect(result.current.canZoom).toBe(true);
    act(() => result.current.zoomToSelection());
    expect(ol.fitToExtent4326).toHaveBeenLastCalledWith(MAP, [108.001, 16, 108.1, 16]);

    act(() => result.current.selectRow('5'));
    act(() => result.current.zoomToSelection());
    expect(ol.fitToExtent4326).toHaveBeenLastCalledWith(MAP, bboxOf(5));

    // A selection the filter hides has no row: the ring on the map gives its extent.
    ol.ringExtent4326.mockReturnValue([107, 15, 107.5, 15.5]);
    act(() => select('999'));
    await flush(10);
    await flush(10);
    act(() => result.current.zoomToSelection());
    expect(ol.fitToExtent4326).toHaveBeenLastCalledWith(MAP, [107, 15, 107.5, 15.5]);
  });

  it('Phóng tới is off while there is nothing to fit', async () => {
    queryLayer.mockImplementation(() => Promise.resolve(answer(0)));
    const { result } = setup();
    await flush(10);
    expect(result.current.canZoom).toBe(false);
    act(() => result.current.zoomToSelection());
    expect(ol.fitToExtent4326).not.toHaveBeenCalled();
  });

  it('a click on the selected feature locates it again, even on its page', async () => {
    const { result } = setup();
    await flush(10);
    act(() => select('42'));
    await flush(10);
    expect(located()).toEqual([]);
    // Paged away, then the same feature clicked again on the map: back to its page.
    act(() => result.current.next());
    await flush(10);
    expect(result.current.page.index).toBe(1);
    act(() => relocate());
    await flush(10);
    await flush(10);
    expect(located()).toHaveLength(1);
    expect(located()[0][2]).toMatchObject({ locate: '42' });
    expect(result.current.page.index).toBe(0);
    // On its page already: located again all the same (a save re-checks the filter this way).
    act(() => relocate());
    await flush(10);
    expect(located()).toHaveLength(2);
  });

  it('the selection is handed to the form with its row, or null properties until read', async () => {
    const { result } = setup();
    await flush(10);
    expect(result.current.selected).toBeNull();
    act(() => result.current.selectRow('5'));
    expect(result.current.selected).toEqual({
      layer: LAYER, id: '5', properties: { ten: 'Trạm 5', cong_suat: 4, ghi_chu: null }, bbox: bboxOf(5),
    });
    // Hidden by the filter and not on the map's loaded source: not known yet.
    act(() => select('999'));
    expect(result.current.selected).toEqual({ layer: LAYER, id: '999', properties: null, bbox: null });
  });

  it('a filter change after the note keeps the selection but drops the note', async () => {
    const { result } = setup();
    await flush(10);
    act(() => select('999'));
    await flush(10);
    await flush(10);
    expect(result.current.selectedOutsideFilter).toBe(true);
    act(() => setFilter({ q: 'x' }));
    expect(result.current.selectedOutsideFilter).toBe(false);
    expect(getTableState().selectedId).toBe('999');
  });
});

describe('useResetTableOnSignOut', () => {
  it('signing out resets the table store: no table, filter or selection outlives the session', () => {
    act(() => { setFilter({ q: 'trạm' }); select('5'); });
    const { rerender } = renderHook(() => useResetTableOnSignOut());
    expect(getTableState().open).not.toBeNull();
    session.status = 'anonymous';
    rerender();
    expect(getTableState()).toMatchObject({ open: null, byLayer: {}, selectedId: null });
  });
});
