import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./model/useUsersPresenter', () => ({
  useUsersPresenter: () => ({
    users: [], canModify: () => true, openEdit: vi.fn(), toggleActive: vi.fn(),
    openCreate: vi.fn(), loading: false, listError: null,
    modal: { mode: 'closed' }, values: {}, fieldErrors: {}, formError: null,
    canSave: true, saving: false, setField: vi.fn(), submitForm: vi.fn(), closeModal: vi.fn(),
  }),
}));
vi.mock('./ui/UserTable.view', () => ({ UserTableView: () => <div>USER_TABLE</div> }));
vi.mock('./ui/UserFormModal.view', () => ({ UserFormModalView: () => null }));

import { UserManagementPanel } from './index';

describe('UserManagementPanel', () => {
  it('renders the user table', () => {
    render(<UserManagementPanel onClose={vi.fn()} />);
    expect(screen.getByText('USER_TABLE')).toBeInTheDocument();
  });

  it('calls onClose from the back control (the route owns dismissal)', async () => {
    const onClose = vi.fn();
    render(<UserManagementPanel onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /back to map/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
