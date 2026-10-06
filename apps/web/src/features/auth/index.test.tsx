import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sessionValue = { status: 'anonymous', currentUser: null, login: vi.fn(), logout: vi.fn() };
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => sessionValue }));

import AuthWidget from './index';

describe('AuthWidget', () => {
  it('opens the sign-in dialog from the Đăng nhập button', async () => {
    render(<AuthWidget />);
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByRole('dialog', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the field errors, focuses the email and sends nothing when submitted empty', async () => {
    sessionValue.login.mockClear();
    render(<AuthWidget />);
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByText('Nhập email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(sessionValue.login).not.toHaveBeenCalled();
  });
});
