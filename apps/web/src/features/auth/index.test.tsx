import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sessionValue = { status: 'anonymous', currentUser: null, login: vi.fn(), logout: vi.fn() };
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => sessionValue }));

import AuthWidget from './index';

describe('AuthWidget', () => {
  it('opens the sign-in dialog from the Đăng nhập button', async () => {
    render(<AuthWidget />);
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getByRole('dialog', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
