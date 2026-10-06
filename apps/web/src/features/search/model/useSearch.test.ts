import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearch } from './useSearch';
import * as api from '../api/search.api';

describe('useSearch', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not query for input shorter than two characters', async () => {
    const spy = vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('a'));
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(spy).not.toHaveBeenCalled();
  });

  it('debounces to a single request for rapid input', async () => {
    const spy = vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('th'));
    act(() => result.current.setQuery('thu'));
    act(() => result.current.setQuery('thuy'));
    await act(async () => { vi.advanceTimersByTime(500); });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('thuy');
  });

  it('does not leave status stuck at loading when clear() runs while a request is still in flight', async () => {
    // A request that never resolves during the test — stands in for "the user
    // picked a result (which calls clear()) before the in-flight fetch settled".
    let resolveFetch: (hits: []) => void = () => {};
    const spy = vi.spyOn(api, 'fetchSearch').mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('thu'));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('loading');

    act(() => result.current.clear());
    expect(result.current.status).toBe('idle');
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);

    // The stale request finally resolves — must not resurrect status/results.
    await act(async () => { resolveFetch([]); });
    expect(result.current.status).toBe('idle');
  });

  it('is done with no results when the server finds nothing', async () => {
    vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery(' hồ krong bukk '));
    await act(async () => { vi.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.results).toEqual([]);
    expect(result.current.answeredQuery).toBe('hồ krong bukk');
  });

  it('is failed when the request rejects, and keeps the query', async () => {
    vi.spyOn(api, 'fetchSearch').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('thu'));
    await act(async () => { vi.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.query).toBe('thu');
    expect(result.current.answeredQuery).toBe('thu');
    expect(result.current.results).toEqual([]);
  });

  it('retry sends the request again without waiting', async () => {
    const spy = vi.spyOn(api, 'fetchSearch').mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('thu'));
    await act(async () => { vi.advanceTimersByTime(500); });
    await waitFor(() => expect(result.current.status).toBe('failed'));

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    expect(spy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('retry does nothing for a query under two characters', async () => {
    const spy = vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('a'));
    act(() => result.current.retry());

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('a failure for an old query does not replace a newer answer', async () => {
    let rejectOld: (e: Error) => void = () => {};
    const newHit = { layerKey: 'lakes' as const, featureId: 'l1', name: 'Hồ Lắk', source: 'layer' as const, lonLat: [108.2, 12.4] as [number, number] };
    vi.spyOn(api, 'fetchSearch').mockImplementation((q: string) =>
      q === 'thu' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve([newHit])
    );
    const { result } = renderHook(() => useSearch());

    act(() => result.current.setQuery('thu'));
    await act(async () => { vi.advanceTimersByTime(500); });
    act(() => result.current.setQuery('hồ'));
    await act(async () => { vi.advanceTimersByTime(500); });
    await waitFor(() => expect(result.current.status).toBe('done'));

    await act(async () => { rejectOld(new Error('late')); });

    expect(result.current.status).toBe('done');
    expect(result.current.results).toEqual([newHit]);
    expect(result.current.answeredQuery).toBe('hồ');
  });
});
