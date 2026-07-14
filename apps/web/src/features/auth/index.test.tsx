import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sessionValue = { status: 'anonymous', currentUser: null, login: vi.fn(), logout: vi.fn() };
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => sessionValue }));

import AuthWidget from './index';

describe('AuthWidget', () => {
  it('shows the Admin login button when anonymous and opens the modal', async () => {
    render(<AuthWidget />);
    const btn = screen.getByRole('button', { name: /admin login/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});

describe('AuthWidget (authenticated)', () => {
  it('shows the user badge with logout', async () => {
    vi.resetModules();
    vi.doMock('../../entities/session/model/session.store', () => ({
      useSession: () => ({ status: 'authenticated', currentUser: { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' }, login: vi.fn(), logout: vi.fn() }),
    }));
    const { default: Fresh } = await import('./index');
    render(<Fresh />);
    expect(screen.getByText('a@webatlas.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });
});
