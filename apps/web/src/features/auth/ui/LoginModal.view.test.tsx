import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginModalView } from './LoginModal.view';

const baseProps = {
  open: true, email: '', password: '', loading: false, error: null as string | null,
  onEmail: vi.fn(), onPassword: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(),
};

describe('LoginModalView', () => {
  it('renders email + password fields and a submit button when open', () => {
    render(<LoginModalView {...baseProps} />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('shows an error message when provided', () => {
    render(<LoginModalView {...baseProps} error="Invalid email or password" />);
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
  });

  it('calls onSubmit when the form is submitted', async () => {
    const onSubmit = vi.fn();
    render(<LoginModalView {...baseProps} email="a@webatlas.test" password="pw" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<LoginModalView {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
