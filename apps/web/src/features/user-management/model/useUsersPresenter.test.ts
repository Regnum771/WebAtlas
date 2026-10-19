import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const listUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
const setUserGroups = vi.fn();
vi.mock('../api/users.api', () => ({
  listUsers: () => listUsers(),
  createUser: (i: unknown) => createUser(i),
  updateUser: (id: string, p: unknown) => updateUser(id, p),
  setUserGroups: (id: string, ids: unknown) => setUserGroups(id, ids),
}));

vi.mock('../../access-groups/api/accessGroups.api', () => ({ listGroups: vi.fn() }));
const showToast = vi.fn();
vi.mock('../../../shared/ui/toast.store', () => ({ showToast: (t: unknown) => showToast(t) }));
let mockTree: unknown = null;
vi.mock('../../../entities/session/model/useUnitTree', () => ({ useUnitTree: () => mockTree }));

const invalidate = vi.fn();
vi.mock('../../../shared/api/queryClient', () => ({ queryClient: { invalidateQueries: (a: unknown) => invalidate(a) } }));

const holder: { isAdmin: boolean; grants: Array<{ permission: string; unit: string }> } = { isAdmin: true, grants: [] };
vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', isAdmin: holder.isAdmin, grants: holder.grants } }),
}));

// Mock TanStack: useQuery returns our list; useMutation returns a mutateAsync that calls the fn + onSuccess.
import type { AdminUser } from '../api/users.api';
const groupRows = [
  { id: 'g1', name: 'Tỉnh', description: null, units: ['48'], permissions: ['feature.update'], memberCount: 1 },
  { id: 'g2', name: 'Bộ', description: null, units: ['VN'], permissions: ['users.manage'], memberCount: 0 },
];
const rows: AdminUser[] = [
  { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', is_active: true, created_at: '', updated_at: '', groups: [] },
  { id: 'u2', email: 'ed@b.test', full_name: 'Ed', role: 'viewer', is_active: true, created_at: '', updated_at: '', groups: [{ id: 'g1', name: 'Tỉnh' }] },
];
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: string[] }) => ({
    data: o.queryKey[0] === 'access-groups' ? groupRows : rows,
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
  useMutation: (opts: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void }) => ({
    mutateAsync: async (v: unknown) => { const r = await opts.mutationFn(v); opts.onSuccess?.(); return r; },
    isPending: false,
  }),
}));

import { useUsersPresenter } from './useUsersPresenter';

beforeEach(() => { holder.isAdmin = true; holder.grants = []; mockTree = null; setUserGroups.mockReset(); showToast.mockReset(); listUsers.mockReset(); createUser.mockReset(); updateUser.mockReset(); invalidate.mockReset(); });

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
    expect(result.current.fieldErrors.email).toBe('Email này đã có người dùng.');
    expect(result.current.modal.mode).toBe('create'); // stays open
  });

  it('maps a 400 VALIDATION_ERROR on create to per-field errors from Zod flatten output', async () => {
    const { ApiError } = await import('../../../shared/api/apiClient');
    createUser.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Invalid', { fieldErrors: { password: ['Too short'] }, formErrors: [] }));
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'n@b.test'); result.current.setField('password', 'longenough'); });
    await act(async () => { await result.current.submitForm(); });
    expect(result.current.fieldErrors.password).toBe('Too short');
    expect(result.current.modal.mode).toBe('create'); // stays open
  });

  it('maps a 403 to a Vietnamese permission message', async () => {
    const { ApiError } = await import('../../../shared/api/apiClient');
    createUser.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'n@b.test'); result.current.setField('password', 'longenough'); });
    await act(async () => { await result.current.submitForm(); });
    expect(result.current.formError).toBe('Bạn không có quyền làm việc này.');
  });

  it('reports a non-API failure in Vietnamese', async () => {
    createUser.mockRejectedValue('boom');
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'n@b.test'); result.current.setField('password', 'longenough'); });
    await act(async () => { await result.current.submitForm(); });
    expect(result.current.formError).toBe('Chưa lưu được. Thử lại.');
  });

  describe('groups dialog', () => {
    const TREE = new Map([
      ['VN', { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' }],
      ['48', { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' }],
    ]);

    it('opens with the current memberships and saves the replaced set, then toasts and closes', async () => {
      setUserGroups.mockResolvedValue({});
      const { result } = renderHook(() => useUsersPresenter());
      act(() => result.current.openGroups(rows[1]));
      expect(result.current.groupsDialog.selected).toEqual(['g1']);
      act(() => result.current.toggleGroup('g2'));
      await act(async () => { await result.current.submitGroups(); });
      expect(setUserGroups).toHaveBeenCalledWith('u2', ['g1', 'g2']);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
      expect(result.current.groupsDialog.user).toBeNull();
    });

    it('shows the server message for a 403 ESCALATION and stays open', async () => {
      const { ApiError } = await import('../../../shared/api/apiClient');
      setUserGroups.mockRejectedValue(new ApiError(403, 'ESCALATION', 'Nhóm vượt quá quyền của anh/chị.'));
      const { result } = renderHook(() => useUsersPresenter());
      act(() => result.current.openGroups(rows[1]));
      await act(async () => { await result.current.submitGroups(); });
      expect(result.current.groupsDialog.error).toBe('Nhóm vượt quá quyền của anh/chị.');
      expect(result.current.groupsDialog.user).not.toBeNull();
    });

    it('shows a generic message for any other failure', async () => {
      const { ApiError } = await import('../../../shared/api/apiClient');
      setUserGroups.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
      const { result } = renderHook(() => useUsersPresenter());
      act(() => result.current.openGroups(rows[1]));
      await act(async () => { await result.current.submitGroups(); });
      expect(result.current.groupsDialog.error).toBe('Chưa lưu được nhóm. Thử lại.');
    });

    it('summaryFor expands the user groups from the loaded list', () => {
      mockTree = TREE;
      const { result } = renderHook(() => useUsersPresenter());
      expect(result.current.summaryFor(rows[1])).toEqual(['Sửa: Đà Nẵng']);
      expect(result.current.summaryFor(rows[0])).toEqual(['Quản trị viên — toàn quyền']);
    });

    it('a non-admin holder: no account admin; out-of-scope groups are not hand-over-able; no tree disables all', () => {
      holder.isAdmin = false;
      holder.grants = [{ permission: 'users.manage', unit: '48' }, { permission: 'feature.update', unit: '48' }];
      mockTree = TREE;
      const { result, rerender } = renderHook(() => useUsersPresenter());
      expect(result.current.adminActions).toBe(false);
      expect(result.current.canHandOverGroup(groupRows[0] as never)).toBe(true);
      expect(result.current.canHandOverGroup(groupRows[1] as never)).toBe(false);
      mockTree = null; rerender();
      expect(result.current.canHandOverGroup(groupRows[0] as never)).toBe(false);
    });
  });
});
