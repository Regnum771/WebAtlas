import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getShell, resetShell } from '../../features/shell/model/shell.store';
import { MemoryRouter } from 'react-router-dom';

let mockUser: { id: string; email: string; full_name: string | null; role: string } | null = null;
const logout = vi.fn();
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({
    status: mockUser ? 'authenticated' : 'anonymous',
    currentUser: mockUser,
    logout,
  }),
}));
vi.mock('../../features/auth', () => ({ default: () => <div>AUTH_WIDGET</div> }));
vi.mock('../../features/search', () => ({ default: () => <div>SEARCH_WIDGET</div> }));

import TopBar from './index';

beforeEach(() => { mockUser = null; logout.mockClear(); resetShell(); });

const renderBar = () => render(<MemoryRouter><TopBar /></MemoryRouter>);

describe('TopBar', () => {
  it('shows the brand always', () => {
    renderBar();
    expect(screen.getByText('WebATLAS')).toBeInTheDocument();
  });

  it('anonymous sees the auth widget (login), not a profile', () => {
    renderBar();
    expect(screen.getByText('AUTH_WIDGET')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument();
  });

  it('an authenticated admin sees the profile with Manage users', () => {
    mockUser = { id: '1', email: 'admin@b.test', full_name: 'A', role: 'admin' };
    renderBar();
    expect(screen.getByText('admin@b.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage users/i })).toBeInTheDocument();
  });

  it('an authenticated viewer sees the profile without Manage users', () => {
    mockUser = { id: '2', email: 'v@b.test', full_name: 'V', role: 'viewer' };
    renderBar();
    expect(screen.getByText('v@b.test')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage users/i })).not.toBeInTheDocument();
  });

  it('an anonymous visitor has no assistant button', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Trợ lý' })).not.toBeInTheDocument();
  });

  it('a signed-in user can toggle the assistant from the top bar', async () => {
    mockUser = { id: '2', email: 'v@b.test', full_name: 'V', role: 'viewer' };
    renderBar();
    const button = screen.getByRole('button', { name: 'Trợ lý' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(button);
    expect(getShell().assistantOpen).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
