import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// admin session so RequireRole passes
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: 'me', email: 'a@b.test', full_name: 'A', role: 'admin' }, status: 'authenticated' }),
}));
// presenter stub: one user, closed modal
vi.mock('./model/useUsersPresenter', () => ({
  useUsersPresenter: () => ({
    users: [{ id: 'u2', email: 'ed@b.test', full_name: 'Ed', role: 'editor', is_active: true, created_at: '', updated_at: '' }],
    loading: false, listError: null,
    modal: { mode: 'closed', user: null }, values: { email: '', password: '', full_name: '', role: 'viewer' },
    fieldErrors: {}, formError: null, saving: false, canSave: false,
    canModify: () => true, openCreate: vi.fn(), openEdit: vi.fn(), closeModal: vi.fn(),
    setField: vi.fn(), submitForm: vi.fn(), toggleActive: vi.fn(),
  }),
}));

import UserManagement from './index';

describe('UserManagement container', () => {
  it('renders the user table for an admin when open', () => {
    render(<UserManagement open onClose={vi.fn()} />);
    expect(screen.getByText('ed@b.test')).toBeInTheDocument();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<UserManagement open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
