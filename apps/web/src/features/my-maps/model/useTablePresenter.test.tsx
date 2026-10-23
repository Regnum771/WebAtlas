import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LayerQueryResponse, LayerSummary } from '../api/workspace.api';

const getMap = vi.fn();
const queryLayer = vi.fn();
vi.mock('../api/workspace.api', () => ({
  getMap: (id: string) => getMap(id),
  queryLayer: (...a: unknown[]) => queryLayer(...a),
}));
const MAP = { on: vi.fn(), un: vi.fn() };
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => ({ map: MAP }) }));
vi.mock('./personalLayers', () => ({
  viewExtent4326: () => [100, 10, 101, 11],
  watchViewExtent4326: () => () => {},
}));
const symbolDataUrl = vi.fn(
  (layer: LayerSummary, properties: Record<string, unknown>, geometryType: string) =>
    `data:image/png;base64,${layer.id}-${geometryType}-${String(properties.ten)}`,
);
vi.mock('./personalStyle', () => ({
  symbolDataUrl: (layer: LayerSummary, properties: Record<string, unknown>, geometryType: string) =>
    symbolDataUrl(layer, properties, geometryType),
}));

import { useTablePresenter } from './useTablePresenter';
import { getTableState, openTable, resetTableStore } from './table.store';

const LAYER: LayerSummary = {
  id: 'l1', kind: 'free', title: 'Điểm đo', position: 0, style: {}, geometryType: 'point', fields: [],
  layerKey: null, draftId: null, featureCount: 151, raster: null,
};
const DETAIL = {
  id: 'm1', title: 'Lũ', description: '', ownerId: 'u1', ownerName: 'Tôi', revision: 1,
  updatedAt: '2026-10-01T00:00:00Z', layerCount: 1, role: 'owner', layers: [LAYER],
};
const answer = (matched: number, offset = 0): LayerQueryResponse => ({
  columns: [{ name: 'ten', type: 'text' }, { name: 'cong_suat', type: 'number' }],
  total: 151,
  matched,
  rows: Array.from({ length: Math.min(100, matched - offset) }, (_, i) => ({
    id: String(offset + i + 1),
    properties: { ten: `Trạm ${offset + i + 1}`, cong_suat: i, ghi_chu: null },
    bbox: [108, 16, 108, 16] as [number, number, number, number],
  })),
  position: null,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useTablePresenter(), { wrapper });
}
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  getMap.mockReset().mockResolvedValue(DETAIL);
  queryLayer.mockReset().mockImplementation((_m: string, _l: string, body: { offset: number }) =>
    Promise.resolve(answer(250, body.offset)));
  symbolDataUrl.mockClear();
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
});
