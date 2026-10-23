import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const listShares = vi.fn();
const addShare = vi.fn();
const removeShare = vi.fn();
const searchShareTargets = vi.fn();
vi.mock('../api/workspace.api', () => ({
  listShares: (id: string) => listShares(id),
  addShare: (id: string, t: unknown) => addShare(id, t),
  removeShare: (id: string, s: string) => removeShare(id, s),
  searchShareTargets: (q: string) => searchShareTargets(q),
}));

import { useSharePresenter, SEARCH_DEBOUNCE_MS } from './useSharePresenter';
import { ApiError } from '../../../shared/api/apiClient';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { keys } from './queries';
import { expandMap, getMyMaps, resetMyMapsStore } from './myMaps.store';

const LAN = { id: 's1', userId: 'u2', groupId: null, name: 'Lan', createdAt: '2026-10-01T00:00:00Z' };
const TARGETS = { users: [{ id: 'u2', name: 'Lan', email: 'lan@x.vn' }], groups: [{ id: 'g1', name: 'Phòng QLĐT' }] };

function setup(onGone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(keys.maps, { mine: [{ id: 'm1' }], sharedWithMe: [] });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, onGone, ...renderHook(() => useSharePresenter({ mapId: 'm1', onGone }), { wrapper }) };
}

beforeEach(() => {
  [listShares, addShare, removeShare, searchShareTargets].forEach((m) => m.mockReset());
  resetToasts();
  resetMyMapsStore();
  listShares.mockResolvedValue([]);
  searchShareTargets.mockResolvedValue(TARGETS);
});
afterEach(() => { vi.useRealTimers(); });

describe('useSharePresenter', () => {
  it('searching needs 2 characters and shows users and groups', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.shares).not.toBeNull());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => result.current.setQuery('l'));
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50); });
    expect(searchShareTargets).not.toHaveBeenCalled();
    expect(result.current.results).toBeNull();

    act(() => result.current.setQuery('la'));
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50); });
    expect(searchShareTargets).not.toHaveBeenCalled();
    act(() => result.current.setQuery('lan'));
    await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50); });
    expect(searchShareTargets).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Only the last keystroke is searched.
    expect(searchShareTargets).toHaveBeenCalledTimes(1);
    expect(searchShareTargets).toHaveBeenCalledWith('lan');
    expect(result.current.results).toEqual(TARGETS);
  });

  it('sharing adds the target to Đang chia sẻ với', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.shares).toEqual([]));
    addShare.mockResolvedValue(LAN);
    listShares.mockResolvedValue([LAN]);
    await act(async () => { await result.current.share({ userId: 'u2' }); });
    expect(addShare).toHaveBeenCalledWith('m1', { userId: 'u2' });
    await waitFor(() => expect(result.current.shares).toEqual([LAN]));
  });

  it('revoking asks first', async () => {
    listShares.mockResolvedValue([LAN]);
    const { result } = setup();
    await waitFor(() => expect(result.current.shares).toEqual([LAN]));
    act(() => result.current.askRevoke(LAN));
    expect(removeShare).not.toHaveBeenCalled();
    expect(result.current.pendingRevoke).toEqual({ id: 's1', name: 'Lan' });
    removeShare.mockResolvedValue(undefined);
    listShares.mockResolvedValue([]);
    await act(async () => { await result.current.confirmRevoke(); });
    expect(removeShare).toHaveBeenCalledWith('m1', 's1');
    expect(result.current.pendingRevoke).toBeNull();
    await waitFor(() => expect(result.current.shares).toEqual([]));
  });

  it('cancelling the revoke sends nothing', async () => {
    listShares.mockResolvedValue([LAN]);
    const { result } = setup();
    await waitFor(() => expect(result.current.shares).toEqual([LAN]));
    act(() => result.current.askRevoke(LAN));
    act(() => result.current.cancelRevoke());
    expect(result.current.pendingRevoke).toBeNull();
    expect(removeShare).not.toHaveBeenCalled();
  });

  it('an API refusal is shown as it comes', async () => {
    const { result, onGone } = setup();
    await waitFor(() => expect(result.current.shares).toEqual([]));
    addShare.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Chỉ người tạo bản đồ được sửa bản đồ này.'));
    await act(async () => { await result.current.share({ groupId: 'g1' }); });
    expect(result.current.error).toBe('Chỉ người tạo bản đồ được sửa bản đồ này.');
    expect(onGone).not.toHaveBeenCalled();
  });

  it("the map's own 404 closes the dialog and drops the map", async () => {
    expandMap('m1');
    const { result, onGone, client } = setup();
    await waitFor(() => expect(result.current.shares).toEqual([]));
    addShare.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Không tìm thấy bản đồ.'));
    await act(async () => { await result.current.share({ userId: 'u2' }); });
    expect(onGone).toHaveBeenCalled();
    expect(getMyMaps().expanded.has('m1')).toBe(false);
    expect(getToasts().map((t) => t.title)).toContain('Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.');
    expect(client.getQueryData<{ mine: unknown[] }>(keys.maps)?.mine).toEqual([]);
  });
});
