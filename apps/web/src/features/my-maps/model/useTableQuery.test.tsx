import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { LayerQueryResponse } from '../api/workspace.api';
import { useTableQuery } from './useTableQuery';
import { getTableState, openTable, resetTableStore, setFilter } from './table.store';
import { keys } from './queries';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';

vi.mock('../api/workspace.api');

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}
const answer = (total: number): LayerQueryResponse => ({ columns: [], total, matched: total, rows: [], position: null });
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const queryMock = () => vi.mocked(api.queryLayer);

beforeEach(() => {
  vi.useFakeTimers();
  queryMock().mockReset();
  resetTableStore();
  openTable('m1', 'l1');
});
afterEach(() => { vi.useRealTimers(); });

describe('useTableQuery', () => {
  it('typing quickly sends one query after 300 ms and a late older answer is ignored', async () => {
    let resolveFirst!: (r: LayerQueryResponse) => void;
    queryMock()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue(answer(2));
    const { wrapper } = setup();
    const { result } = renderHook(() => useTableQuery(null), { wrapper });
    await flush();
    expect(queryMock()).toHaveBeenCalledTimes(1);

    act(() => setFilter({ q: 'd' }));
    await flush(100);
    act(() => setFilter({ q: 'da' }));
    await flush(100);
    act(() => setFilter({ q: 'dap' }));
    await flush(299);
    expect(queryMock()).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(queryMock()).toHaveBeenCalledTimes(2);
    expect(queryMock().mock.calls[1][2]).toMatchObject({ q: 'dap', offset: 0 });
    await flush(10);
    expect(result.current.data?.total).toBe(2);

    await act(async () => { resolveFirst(answer(99)); await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.data?.total).toBe(2);
  });

  it('typing on page 3 sends one query, for the new text on page 0, after 300 ms', async () => {
    queryMock().mockResolvedValue(answer(500));
    const { wrapper } = setup();
    const { result } = renderHook(() => useTableQuery(null), { wrapper });
    await flush();
    act(() => setFilter({ page: 3 }));
    await flush(10);
    expect(queryMock()).toHaveBeenCalledTimes(2);
    expect(queryMock().mock.calls[1][2]).toMatchObject({ offset: 300 });
    expect(result.current.page).toBe(3);

    act(() => setFilter({ q: 's' }));
    await flush(100);
    act(() => setFilter({ q: 'so' }));
    await flush(299);
    expect(queryMock()).toHaveBeenCalledTimes(2);
    // While the text settles the table still shows page 3.
    expect(result.current.page).toBe(3);
    await flush(1);
    expect(queryMock()).toHaveBeenCalledTimes(3);
    expect(queryMock().mock.calls[2][2]).toMatchObject({ q: 'so', offset: 0 });
    expect(result.current.page).toBe(0);
    await flush(10);
    expect(queryMock()).toHaveBeenCalledTimes(3);
  });

  it('a condition still waiting for its value is not sent', async () => {
    queryMock().mockResolvedValue(answer(5));
    const { wrapper } = setup();
    renderHook(() => useTableQuery(null), { wrapper });
    await flush();
    act(() => setFilter({ conditions: [{ field: 'ten', op: 'contains', value: '' }, { field: 'x', op: 'empty' }] }));
    await flush(310);
    expect(queryMock()).toHaveBeenCalledTimes(2);
    expect(queryMock().mock.calls[1][2].conditions).toEqual([{ field: 'x', op: 'empty' }]);
    // Only the value-less condition changing sends nothing new.
    act(() => setFilter({ conditions: [{ field: 'ten', op: 'eq', value: ' ' }, { field: 'x', op: 'empty' }] }));
    await flush(310);
    expect(queryMock()).toHaveBeenCalledTimes(2);
  });

  it('in view sends the extent; off sends none', async () => {
    queryMock().mockResolvedValue(answer(1));
    const { wrapper } = setup();
    const extent: [number, number, number, number] = [100, 10, 101, 11];
    renderHook(() => useTableQuery(extent), { wrapper });
    await flush();
    expect(queryMock().mock.calls[0][2].bbox).toBeUndefined();
    act(() => setFilter({ inView: true }));
    await flush(10);
    expect(queryMock().mock.calls[1][2].bbox).toEqual(extent);
    act(() => setFilter({ inView: false }));
    await flush(10);
    expect(queryMock().mock.calls[2][2].bbox).toBeUndefined();
  });

  it('shows the API message for a 400 and the network copy otherwise', async () => {
    queryMock().mockRejectedValueOnce(new ApiError(400, 'BAD_REQUEST', 'Trường không tồn tại.'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useTableQuery(null), { wrapper });
    await flush(10);
    expect(result.current.error).toBe('Trường không tồn tại.');
    queryMock().mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Network request failed'));
    await act(async () => { result.current.refetch(); await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.error).toBe('Không tải được bảng. Thử lại.');
  });

  it('pages of 100: offset is page times 100 and limit is 100', async () => {
    queryMock().mockResolvedValue(answer(1));
    const { wrapper } = setup();
    renderHook(() => useTableQuery(null), { wrapper });
    await flush();
    expect(queryMock().mock.calls[0][2]).toMatchObject({ offset: 0, limit: 100 });
    act(() => setFilter({ page: 2 }));
    await flush(10);
    expect(queryMock().mock.calls[1][2]).toMatchObject({ offset: 200, limit: 100 });
  });

  it("the map's own 404 drops the map and closes the table; another 404 does not", async () => {
    resetToasts();
    queryMock().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy lớp.'));
    const first = setup();
    first.qc.setQueryData(keys.map('m1'), { id: 'm1', revision: 1, layers: [] });
    const r1 = renderHook(() => useTableQuery(null), { wrapper: first.wrapper });
    await flush(10);
    expect(r1.result.current.error).toBe('Không tải được bảng. Thử lại.');
    expect(first.qc.getQueryData(keys.map('m1'))).toBeDefined();
    expect(getTableState().open).not.toBeNull();
    expect(getToasts()).toHaveLength(0);
    r1.unmount();

    queryMock().mockReset();
    queryMock().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản đồ.'));
    const second = setup();
    second.qc.setQueryData(keys.map('m1'), { id: 'm1', revision: 1, layers: [] });
    renderHook(() => useTableQuery(null), { wrapper: second.wrapper });
    await flush(10);
    expect(second.qc.getQueryData(keys.map('m1'))).toBeUndefined();
    expect(getTableState().open).toBeNull();
    expect(getToasts()).toHaveLength(1);
  });
});
