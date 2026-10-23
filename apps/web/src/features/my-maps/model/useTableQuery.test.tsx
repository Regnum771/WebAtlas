import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import type { LayerQueryResponse } from '../api/workspace.api';
import { useTableQuery } from './useTableQuery';
import { openTable, resetTableStore, setFilter } from './table.store';

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
});
