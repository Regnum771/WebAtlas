import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserTableView } from './UserTable.view';
import type { AdminUser } from '../api/users.api';

const users: AdminUser[] = [
  { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '', groups: [] },
  { id: 'u2', email: 'ed@b.test', full_name: null, role: 'viewer', is_active: false, created_at: '2026-01-02T00:00:00Z', updated_at: '', groups: [{ id: 'g1', name: 'Tỉnh' }] },
];

const extra = { adminActions: true, onGroups: vi.fn(), onRetry: vi.fn(), summaryFor: () => ['Chỉ xem'] };

describe('UserTableView', () => {
  it('renders a row per user with role and a locked badge', () => {
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} />);
    expect(screen.getByText('me@b.test')).toBeInTheDocument();
    expect(screen.getByText('ed@b.test')).toBeInTheDocument();
    expect(screen.getByText('Đã khoá')).toBeInTheDocument();
    expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();
  });

  it('disables Sửa/Khoá on a row that cannot be modified', () => {
    const canModify = (u: AdminUser) => u.id !== 'me';
    render(<UserTableView users={users} canModify={canModify} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} />);
    // the "me" row's edit button is disabled
    const editButtons = screen.getAllByRole('button', { name: 'Sửa' });
    expect(editButtons[0]).toBeDisabled();
  });

  it('calls onNew when the Thêm người dùng button is clicked', async () => {
    const onNew = vi.fn();
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={onNew} loading={false} listError={null} {...extra} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thêm người dùng' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('shows roles and dates in Vietnamese', () => {
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} />);
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument();
    expect(screen.getByText('Người xem')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-01-01T00:00:00Z').toLocaleDateString('vi-VN'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở khoá' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Khoá' })).toBeInTheDocument();
  });

  it('shows a spinner status while loading and no table', () => {
    render(<UserTableView users={[]} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading listError={null} {...extra} />);
    expect(screen.getByRole('status', { name: 'Đang tải' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a users.manage holder sees only the Nhóm action, no create, edit or lock controls', () => {
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} adminActions={false} />);
    expect(screen.queryByRole('button', { name: 'Thêm người dùng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Khoá' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở khoá' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Nhóm' }).length).toBeGreaterThan(0);
  });

  it('shows the effective summary, and the admin line for an admin row', () => {
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} summaryFor={(u) => (u.role === 'admin' ? ['Quản trị viên — toàn quyền'] : ['Duyệt: Xã Điện Hồng'])} />);
    expect(screen.getByText('Quản trị viên — toàn quyền')).toBeInTheDocument();
    expect(screen.getByText('Duyệt: Xã Điện Hồng')).toBeInTheDocument();
  });

  it('opens the groups dialog for a row', async () => {
    const onGroups = vi.fn();
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} onGroups={onGroups} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Nhóm' })[1]);
    expect(onGroups).toHaveBeenCalledWith(users[1]);
  });

  it('shows the load error with Thử lại, and an empty message', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<UserTableView users={[]} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError="Không tải được danh sách người dùng." {...extra} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<UserTableView users={[]} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} />);
    expect(screen.getByText('Chưa có người dùng nào.')).toBeInTheDocument();
  });

  it('shows one group-load error with Thử lại, not one per row', async () => {
    const onRetryGroups = vi.fn();
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} summaryFor={() => ['Không tải được nhóm']} groupsError onRetryGroups={onRetryGroups} />);
    expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetryGroups).toHaveBeenCalled();
  });

  it('marks the Ngày tạo column so the narrow-width CSS can hide it', () => {
    const { container } = render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} {...extra} />);
    const header = [...container.querySelectorAll('th')].find((th) => th.textContent === 'Ngày tạo');
    expect(header).toHaveClass('col-created');
    expect(container.querySelectorAll('td.col-created')).toHaveLength(users.length);
  });
});
