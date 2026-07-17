import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const listUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
vi.mock('../api/users.api', () => ({
  listUsers: () => listUsers(),
  createUser: (i: unknown) => createUser(i),
  updateUser: (id: string, p: unknown) => updateUser(id, p),
}));

const invalidate = vi.fn();
vi.mock('../../../shared/api/queryClient', () => ({ queryClient: { invalidateQueries: (a: unknown) => invalidate(a) } }));

vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin' } }),
}));

// Mock TanStack: useQuery returns our list; useMutation returns a mutateAsync that calls the fn + onSuccess.
const rows = [
  { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', is_active: true, created_at: '', updated_at: '' },
  { id: 'u2', email: 'ed@b.test', full_name: 'Ed', role: 'editor', is_active: true, created_at: '', updated_at: '' },
];
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: rows, isLoading: false, error: null }),
  useMutation: (opts: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void }) => ({
    mutateAsync: async (v: unknown) => { const r = await opts.mutationFn(v); opts.onSuccess?.(); return r; },
    isPending: false,
  }),
}));

import { useUsersPresenter } from './useUsersPresenter';

beforeEach(() => { listUsers.mockReset(); createUser.mockReset(); updateUser.mockReset(); invalidate.mockReset(); });

describe('useUsersPresenter', () => {
  it('exposes the user list', () => {
    const { result } = renderHook(() => useUsersPresenter());
    expect(result.current.users.map((u) => u.id)).toEqual(['me', 'u2']);
  });

  it('self-guard: cannot modify own row, can modify others', () => {
    const { result } = renderHook(() => useUsersPresenter());
    expect(result.current.canModify(rows[0])).toBe(false); // me
    expect(result.current.canModify(rows[1])).toBe(true);  // u2
  });

  it('create requires email + password >= 8', () => {
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setField('email', 'x@b.test'));
    act(() => result.current.setField('password', 'short')); // 5 chars
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setField('password', 'longenough'));
    expect(result.current.canSave).toBe(true);
  });

  it('submitting create calls createUser and invalidates users, then closes', async () => {
    createUser.mockResolvedValue({ id: 'new' });
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'n@b.test'); result.current.setField('password', 'longenough'); result.current.setField('role', 'viewer'); });
    await act(async () => { await result.current.submitForm(); });
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'n@b.test', password: 'longenough', role: 'viewer' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(result.current.modal.mode).toBe('closed');
  });

  it('toggleActive flips is_active via updateUser', async () => {
    updateUser.mockResolvedValue({ id: 'u2' });
    const { result } = renderHook(() => useUsersPresenter());
    await act(async () => { await result.current.toggleActive(rows[1]); });
    expect(updateUser).toHaveBeenCalledWith('u2', { is_active: false });
  });

  it('maps a 409 CONFLICT on create to an email field error', async () => {
    const { ApiError } = await import('../../../shared/api/apiClient');
    createUser.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Email already in use'));
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'dupe@b.test'); result.current.setField('password', 'longenough'); });
    await act(async () => { await result.current.submitForm(); });
    expect(result.current.fieldErrors.email).toBe('Email already in use');
    expect(result.current.modal.mode).toBe('create'); // stays open
  });
});
