import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import * as ws from '../api/workspace.api';
import * as users from '../../user-management/api/users.api';
import { useUsagePresenter, GB } from './useUsagePresenter';

vi.mock('../api/workspace.api');
vi.mock('../../user-management/api/users.api');

const owner = (userId: string, usageBytes: number, quotaBytes = 5 * GB) => ({
  userId, email: `${userId}@b.test`, maps: 1, layers: 2, features: 3, bytes: usageBytes, usageBytes, quotaBytes,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useUsagePresenter(), { wrapper });
}

beforeEach(() => { vi.resetAllMocks(); });

describe('useUsagePresenter', () => {
  it('lists owners with usage and quota, largest first', async () => {
    vi.mocked(ws.adminSummary).mockResolvedValue([owner('small', 10), owner('big', 900), owner('mid', 50)]);
    const { result } = setup();
    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.rows.map((r) => r.userId)).toEqual(['big', 'mid', 'small']);
  });

  it('a row over its quota is marked', async () => {
    vi.mocked(ws.adminSummary).mockResolvedValue([
      owner('over', 6 * GB), owner('at', 5 * GB), owner('under', 1), owner('empty-at-zero', 0, 0), owner('some-at-zero', 1, 0),
    ]);
    const { result } = setup();
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(Object.fromEntries(result.current.rows.map((r) => [r.userId, r.overQuota]))).toEqual({
      over: true, at: true, under: false, 'empty-at-zero': false, 'some-at-zero': true,
    });
  });

  it('saving 2,5 GB sends 2684354560 bytes', async () => {
    vi.mocked(ws.adminSummary).mockResolvedValue([owner('u1', 10)]);
    vi.mocked(users.updateUser).mockResolvedValue({} as never);
    const { result } = setup();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.startEdit('u1'));
    expect(result.current.draft).toBe('5');
    act(() => result.current.setDraft('2,5'));
    await act(async () => { await result.current.save(); });
    expect(users.updateUser).toHaveBeenCalledWith('u1', { quotaBytes: 2684354560 });
    expect(result.current.editingId).toBeNull();
  });

  it('the editor opens with the quota written with a decimal comma', async () => {
    vi.mocked(ws.adminSummary).mockResolvedValue([owner('u1', 10, 2.5 * GB)]);
    const { result } = setup();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.startEdit('u1'));
    expect(result.current.draft).toBe('2,5');
    expect(result.current.canSave).toBe(true);
  });

  it('refuses an empty or negative amount and keeps the editor open', async () => {
    vi.mocked(ws.adminSummary).mockResolvedValue([owner('u1', 10)]);
    const { result } = setup();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.startEdit('u1'));
    act(() => result.current.setDraft('-1'));
    expect(result.current.canSave).toBe(false);
    await act(async () => { await result.current.save(); });
    expect(users.updateUser).not.toHaveBeenCalled();
    expect(result.current.editingId).toBe('u1');
  });

  it('shows the API message when saving fails and keeps the draft', async () => {
    vi.mocked(ws.adminSummary).mockResolvedValue([owner('u1', 10)]);
    vi.mocked(users.updateUser).mockRejectedValue(new Error('Từ chối'));
    const { result } = setup();
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.startEdit('u1'));
    act(() => result.current.setDraft('3'));
    await act(async () => { await result.current.save(); });
    expect(result.current.saveError).toBe('Từ chối');
    expect(result.current.editingId).toBe('u1');
    expect(result.current.draft).toBe('3');
  });
});
