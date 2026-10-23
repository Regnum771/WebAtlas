import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../../../shared/api/apiClient';
import * as api from '../api/workspace.api';
import { useJob, useMapWrite, MapChangedError, MapGoneError } from './queries';

vi.mock('../api/workspace.api');

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}
const job = (status: string) => ({
  id: 'j', kind: 'export', status, mapId: null, progress: 0, steps: [], result: null, error: null, createdAt: '', finishedAt: null,
});

describe('useJob', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('polls every second until succeeded and then stops', async () => {
    const getJob = vi.mocked(api.getJob);
    getJob
      .mockResolvedValueOnce(job('queued') as never)
      .mockResolvedValueOnce(job('running') as never)
      .mockResolvedValue(job('succeeded') as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useJob('j'), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getJob).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(getJob).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(getJob).toHaveBeenCalledTimes(3);
    // Let react-query's batched notification reach the hook.
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.data?.status).toBe('succeeded');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it('does not fetch without an id', () => {
    vi.mocked(api.getJob).mockClear();
    const { wrapper } = setup();
    renderHook(() => useJob(null), { wrapper });
    expect(api.getJob).not.toHaveBeenCalled();
  });
});

describe('useMapWrite', () => {
  it('sends the cached revision; MAP_CHANGED invalidates and throws MapChangedError; 404 throws MapGoneError', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['ws', 'map', 'm1'], { id: 'm1', revision: 7, layers: [] });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useMapWrite('m1'), { wrapper });

    const write = vi.fn().mockResolvedValue('ok');
    await expect(result.current.run(write)).resolves.toBe('ok');
    expect(write).toHaveBeenCalledWith(7);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'map', 'm1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'maps'] });

    spy.mockClear();
    const changed = vi.fn().mockRejectedValue(new ApiError(409, 'MAP_CHANGED', 'Bản đồ đã thay đổi ở nơi khác.'));
    const err = await result.current.run(changed).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MapChangedError);
    expect((err as Error).message).toBe('Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'map', 'm1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'maps'] });

    spy.mockClear();
    const gone = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    const err2 = await result.current.run(gone).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(MapGoneError);
    expect((err2 as Error).message).toBe('Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'maps'] });
    expect(qc.getQueryData(['ws', 'map', 'm1'])).toBeUndefined();
  });
});
