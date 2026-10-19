import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getShell, resetShell } from '../../features/shell/model/shell.store';
import { MemoryRouter } from 'react-router-dom';

let mockUser: { id: string; email: string; full_name: string | null; role: string; isAdmin: boolean; grants: [] } | null = null;
const logout = vi.fn();
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({
    status: mockUser ? 'authenticated' : 'anonymous',
    currentUser: mockUser,
    logout,
  }),
}));
vi.mock('../../entities/session/model/useUnitTree', () => ({ useUnitTree: () => null }));
vi.mock('../../features/auth', () => ({ default: () => <button type="button">Đăng nhập</button> }));
vi.mock('../../features/search', () => ({ default: () => <div>SEARCH_WIDGET</div> }));

import TopBar from './index';

beforeEach(() => { mockUser = null; logout.mockClear(); resetShell(); });

const renderBar = () => render(<MemoryRouter><TopBar /></MemoryRouter>);

describe('TopBar', () => {
  it('an anonymous visitor sees Đăng nhập and no Trợ lý', () => {
    renderBar();
    expect(screen.getByRole('link', { name: 'WebATLAS' })).toBeInTheDocument();
    expect(screen.getByText('SEARCH_WIDGET')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trợ lý' })).toBeNull();
  });

  it('a signed-in user sees Trợ lý and the account menu, and no Đăng nhập', async () => {
    mockUser = { id: '1', email: 'admin@b.test', full_name: 'A', role: 'admin', isAdmin: true, grants: [] };
    renderBar();
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quản trị viên' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quản lý' })).toHaveAttribute('href', '/quan-ly');
    const assistant = screen.getByRole('button', { name: 'Trợ lý' });
    expect(assistant).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(assistant);
    expect(getShell().assistantOpen).toBe(true);
    expect(assistant).toHaveAttribute('aria-pressed', 'true');
  });
});
