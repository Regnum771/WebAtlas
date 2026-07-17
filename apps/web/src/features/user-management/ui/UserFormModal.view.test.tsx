import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserFormModalView } from './UserFormModal.view';

const base = {
  values: { email: 'e@b.test', password: '', full_name: 'E', role: 'viewer' as const },
  fieldErrors: {}, formError: null, canSave: true, saving: false,
  onField: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(),
};

describe('UserFormModalView', () => {
  it('create mode shows a password field', () => {
    render(<UserFormModalView open mode="create" {...base} />);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('edit mode hides password and shows email read-only', () => {
    render(<UserFormModalView open mode="edit" {...base} />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('readonly');
  });

  it('disables Save when canSave is false', () => {
    render(<UserFormModalView open mode="create" {...base} canSave={false} />);
    expect(screen.getByRole('button', { name: /save|create/i })).toBeDisabled();
  });
});
