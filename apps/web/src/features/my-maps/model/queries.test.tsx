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

  it('a transient error keeps polling', async () => {
    const getJob = vi.mocked(api.getJob);
    getJob.mockReset();
    getJob
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Network request failed'))
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
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.data?.status).toBe('succeeded');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it('a 401 stops polling', async () => {
    const getJob = vi.mocked(api.getJob);
    getJob.mockReset();
    getJob.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Phiên đăng nhập đã hết hạn.'));
    const { wrapper } = setup();
    renderHook(() => useJob('j'), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getJob).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getJob).toHaveBeenCalledTimes(1);
  });

  it('does not fetch without an id', () => {
    vi.mocked(api.getJob).mockClear();
    const { wrapper } = setup();
    renderHook(() => useJob(null), { wrapper });
    expect(api.getJob).not.toHaveBeenCalled();
  });
});

describe('useMapWrite', () => {
  it('an uncached map is read first and its revision sent', async () => {
    const { wrapper } = setup();
    vi.mocked(api.getMap).mockResolvedValue({ id: 'm2', revision: 4, layers: [] } as never);
    const { result } = renderHook(() => useMapWrite('m2'), { wrapper });
    const write = vi.fn().mockResolvedValue('ok');
    await expect(result.current.run(write)).resolves.toBe('ok');
    expect(api.getMap).toHaveBeenCalledWith('m2');
    expect(write).toHaveBeenCalledWith(4);
  });

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
    const gone = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản đồ.'));
    const err2 = await result.current.run(gone).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(MapGoneError);
    expect((err2 as Error).message).toBe('Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ws', 'maps'] });
    expect(qc.getQueryData(['ws', 'map', 'm1'])).toBeUndefined();
  });

  it('a 404 for a missing layer or feature is rethrown unchanged and keeps the map', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['ws', 'map', 'm1'], { id: 'm1', revision: 7, layers: [] });
    const { result } = renderHook(() => useMapWrite('m1'), { wrapper });
    for (const message of ['Không tìm thấy lớp.', 'Không tìm thấy đối tượng.']) {
      const original = new ApiError(404, 'NOT_FOUND', message);
      const err = await result.current.run(vi.fn().mockRejectedValue(original)).catch((e: unknown) => e);
      expect(err).toBe(original);
      expect(qc.getQueryData(['ws', 'map', 'm1'])).toEqual({ id: 'm1', revision: 7, layers: [] });
    }
  });

  it('writes to one map run one at a time; another map does not wait', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['ws', 'map', 'm1'], { id: 'm1', revision: 1, layers: [] });
    qc.setQueryData(['ws', 'map', 'm2'], { id: 'm2', revision: 1, layers: [] });
    const one = renderHook(() => useMapWrite('m1'), { wrapper }).result;
    const two = renderHook(() => useMapWrite('m2'), { wrapper }).result;
    const log: string[] = [];
    let release!: () => void;
    const slow = vi.fn(async (rev: number) => {
      log.push(`slow start ${rev}`);
      await new Promise<void>((r) => { release = r; });
      log.push('slow end');
      return { revision: 2 };
    });
    const next = vi.fn(async (rev: number) => { log.push(`next start ${rev}`); return { revision: 3 }; });
    const other = vi.fn(async () => { log.push('other'); return 'x'; });
    const p1 = one.current.run(slow);
    const p2 = one.current.run(next);
    await two.current.run(other);
    await Promise.resolve();
    expect(log).toEqual(['slow start 1', 'other']);
    release();
    await Promise.all([p1, p2]);
    // The queued write read the revision the first one answered.
    expect(log).toEqual(['slow start 1', 'other', 'slow end', 'next start 2']);
  });

  it('refetch: false keeps the cache for the caller to patch', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['ws', 'map', 'm1'], { id: 'm1', revision: 1, layers: [] });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useMapWrite('m1'), { wrapper });
    const after = vi.fn();
    await result.current.run(async () => ({ revision: 2 }), { refetch: false, after });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['ws', 'map', 'm1'] });
    expect(qc.getQueryData(['ws', 'map', 'm1'])).toEqual({ id: 'm1', revision: 2, layers: [] });
    expect(after).toHaveBeenCalled();
  });
});
