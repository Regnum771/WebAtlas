import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { buildUnitTree } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';

const listGroups = vi.fn();
const createGroup = vi.fn();
const updateGroup = vi.fn();
const deleteGroup = vi.fn();
vi.mock('../api/accessGroups.api', () => ({
  listGroups: () => listGroups(),
  createGroup: (i: unknown) => createGroup(i),
  updateGroup: (id: string, i: unknown) => updateGroup(id, i),
  deleteGroup: (id: string) => deleteGroup(id),
}));

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
]);
vi.mock('../../../entities/session/model/useUnitTree', () => ({ useUnitTree: () => TREE }));

import { useGroupsPresenter } from './useGroupsPresenter';

const GROUP = { id: 'g1', name: 'Tổ Đà Nẵng', description: null, units: ['48'], permissions: ['map.import' as const], memberCount: 3 };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useGroupsPresenter(), { wrapper });
}

beforeEach(() => {
  [listGroups, createGroup, updateGroup, deleteGroup].forEach((m) => m.mockReset());
  listGroups.mockResolvedValue([GROUP]);
});

describe('useGroupsPresenter', () => {
  it('choosing the tỉnh template ticks the four permissions and limits the picker to provinces first', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate());
    act(() => result.current.chooseTemplate('tinh'));
    expect(result.current.values.permissions).toEqual(['feature.create', 'feature.update', 'feature.delete', 'map.import']);
    expect(result.current.values.units).toEqual([]);
    expect(result.current.values.name).toBe('Cán bộ cấp tỉnh');
    expect(result.current.pickerLevel).toBe('province');
  });

  it('the Bộ template preselects VN; Trống clears everything', async () => {
    const { result } = setup();
    act(() => result.current.openCreate());
    act(() => result.current.chooseTemplate('bo'));
    expect(result.current.values.units).toEqual(['VN']);
    act(() => result.current.chooseTemplate('blank'));
    expect(result.current.values.units).toEqual([]);
    expect(result.current.values.permissions).toEqual([]);
  });

  it('an unknown-unit 400 lands on the units field', async () => {
    createGroup.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Đơn vị 99999 không tồn tại.'));
    const { result } = setup();
    act(() => result.current.openCreate());
    act(() => { result.current.setField('name', 'X'); result.current.setUnits(['99999']); result.current.togglePermission('map.import'); });
    await act(async () => { await result.current.submit(); });
    expect(result.current.fieldErrors.units).toBe('Đơn vị 99999 không tồn tại.');
    expect(result.current.modal.mode).toBe('create');
  });

  it('a duplicate-name 409 lands on the name field', async () => {
    createGroup.mockRejectedValue(new ApiError(409, 'CONFLICT', 'dup'));
    const { result } = setup();
    act(() => result.current.openCreate());
    act(() => { result.current.setField('name', 'X'); result.current.setUnits(['48']); result.current.togglePermission('map.import'); });
    await act(async () => { await result.current.submit(); });
    expect(result.current.fieldErrors.name).toBe('Đã có nhóm tên này.');
  });

  it('saves and closes on success', async () => {
    createGroup.mockResolvedValue(GROUP);
    const { result } = setup();
    act(() => result.current.openCreate());
    act(() => { result.current.setField('name', ' X '); result.current.setUnits(['48']); result.current.togglePermission('map.import'); });
    expect(result.current.canSave).toBe(true);
    await act(async () => { await result.current.submit(); });
    expect(createGroup).toHaveBeenCalledWith({ name: 'X', units: ['48'], permissions: ['map.import'] });
    expect(result.current.modal.mode).toBe('closed');
  });

  it('delete asks with the member count, then deletes', async () => {
    deleteGroup.mockResolvedValue(undefined);
    const { result } = setup();
    await waitFor(() => expect(result.current.groups).toHaveLength(1));
    act(() => result.current.askDelete(GROUP));
    expect(result.current.deleteMessage).toBe('Xoá nhóm Tổ Đà Nẵng? 3 người sẽ mất các quyền của nhóm này.');
    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteGroup).toHaveBeenCalledWith('g1');
    expect(result.current.pendingDelete).toBeNull();
  });

  it('a failed load exposes an error and a retry', async () => {
    listGroups.mockRejectedValue(new Error('boom'));
    const { result } = setup();
    await waitFor(() => expect(result.current.listError).toBeTruthy());
    listGroups.mockResolvedValue([]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.listError).toBeNull());
  });
});
