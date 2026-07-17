import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserTableView } from './UserTable.view';
import type { AdminUser } from '../api/users.api';

const users: AdminUser[] = [
  { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '' },
  { id: 'u2', email: 'ed@b.test', full_name: null, role: 'editor', is_active: false, created_at: '2026-01-02T00:00:00Z', updated_at: '' },
];

describe('UserTableView', () => {
  it('renders a row per user with role and an inactive badge', () => {
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} />);
    expect(screen.getByText('me@b.test')).toBeInTheDocument();
    expect(screen.getByText('ed@b.test')).toBeInTheDocument();
    expect(screen.getByText(/inactive/i)).toBeInTheDocument();
  });

  it('disables Edit/Deactivate on a row that cannot be modified', () => {
    const canModify = (u: AdminUser) => u.id !== 'me';
    render(<UserTableView users={users} canModify={canModify} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} />);
    // the "me" row's edit button is disabled
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    expect(editButtons[0]).toBeDisabled();
  });

  it('calls onNew when the New user button is clicked', async () => {
    const onNew = vi.fn();
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={onNew} loading={false} listError={null} />);
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    expect(onNew).toHaveBeenCalled();
  });
});
