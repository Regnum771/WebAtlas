import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sessionValue = { status: 'anonymous', currentUser: null, login: vi.fn(), logout: vi.fn() };
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => sessionValue }));

import AuthWidget from './index';
import { ApiError } from '../../shared/api/apiClient';

async function openAndType(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  await user.type(screen.getByLabelText('Email'), 'a@b.vn');
  await user.type(screen.getByLabelText('Mật khẩu'), 'bi-mat-1');
  await user.click(screen.getByRole('button', { name: 'Hiện' }));
  expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'text');
}

/** After reopening: the email is kept, the password is gone and hidden again. */
async function expectCleanReopen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(screen.getByLabelText('Email')).toHaveValue('a@b.vn');
  expect(screen.getByLabelText('Mật khẩu')).toHaveValue('');
  expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'password');
  expect(screen.getByRole('button', { name: 'Hiện' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('alert')).toBeNull();
}

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

  it('Escape clears the password and hides it again, keeping the email', async () => {
    const user = userEvent.setup();
    render(<AuthWidget />);
    await openAndType(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectCleanReopen(user);
  });

  it('closing from the backdrop clears the password and the form error', async () => {
    sessionValue.login.mockReset().mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'bad'));
    const user = userEvent.setup();
    render(<AuthWidget />);
    await openAndType(user);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng');
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectCleanReopen(user);
  });

  it('a successful sign-in clears the password and hides it again', async () => {
    sessionValue.login.mockReset().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AuthWidget />);
    await openAndType(user);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đăng nhập' }));
    expect(sessionValue.login).toHaveBeenCalledWith({ email: 'a@b.vn', password: 'bi-mat-1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await expectCleanReopen(user);
  });
});
