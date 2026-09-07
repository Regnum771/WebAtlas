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

  it('does not leave loading stuck at true when clear() runs while a request is still in flight', async () => {
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
    expect(result.current.loading).toBe(true);

    act(() => result.current.clear());
    expect(result.current.loading).toBe(false);
    expect(result.current.query).toBe('');
    expect(result.current.results).toEqual([]);

    // The stale request finally resolves — must not resurrect loading/results.
    await act(async () => { resolveFetch([]); });
    expect(result.current.loading).toBe(false);
  });
});
