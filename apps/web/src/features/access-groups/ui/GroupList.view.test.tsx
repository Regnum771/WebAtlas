import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildUnitTree } from '@webatlas/shared';
import { GroupListView } from './GroupList.view';

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
]);
const G = { id: 'g1', name: 'Tổ Đà Nẵng', description: null, units: ['48'], permissions: ['map.import' as const], memberCount: 3 };
const base = { groups: [G], tree: TREE, loading: false, listError: null, onRetry: vi.fn(), onNew: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };

describe('GroupListView', () => {
  it('shows the empty state with a create button', async () => {
    const onNew = vi.fn();
    render(<GroupListView {...base} groups={[]} onNew={onNew} />);
    expect(screen.getByText('Chưa có nhóm nào.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tạo nhóm' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('shows a spinner while loading', () => {
    render(<GroupListView {...base} groups={[]} loading />);
    expect(screen.getByRole('status', { name: 'Đang tải' })).toBeInTheDocument();
    expect(screen.queryByText('Chưa có nhóm nào.')).toBeNull();
  });

  it('a load error offers Thử lại', async () => {
    const onRetry = vi.fn();
    render(<GroupListView {...base} groups={[]} listError="Không tải được danh sách nhóm quyền." onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('lists unit names, permission labels and the member count; Xoá calls onDelete', async () => {
    const onDelete = vi.fn();
    render(<GroupListView {...base} onDelete={onDelete} />);
    expect(screen.getByText('Đà Nẵng')).toBeInTheDocument();
    expect(screen.getByText('nhập bản đồ')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá' }));
    expect(onDelete).toHaveBeenCalledWith(G);
  });
});
