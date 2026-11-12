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
vi.mock('../../entities/platform/model/platformServices.store', () => ({
  usePlatformServices: () => ({
    services: [
      { id: 'geonode', label: 'Danh mục bản đồ', url: 'http://localhost:8000/', status: 'up', checkedAt: '' },
      { id: 'dagster', label: 'Điều phối dữ liệu', url: 'http://localhost:3070/', status: 'up', checkedAt: '' },
    ],
    failed: false,
  }),
}));

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
    expect(screen.getByRole('link', { name: /Danh mục/ })).toHaveAttribute('href', 'http://localhost:8000/');
    expect(screen.queryByRole('link', { name: /Điều phối/ })).toBeNull();
  });

  it('a signed-in user sees Trợ lý and the account menu, and no Đăng nhập', async () => {
    mockUser = { id: '1', email: 'admin@b.test', full_name: 'Trần Thị Bình', role: 'admin', isAdmin: true, grants: [] };
    renderBar();
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Trần Thị Bình' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('link', { name: 'Quản lý' })).toHaveAttribute('href', '/quan-ly');
    expect(screen.getByRole('link', { name: /Điều phối/ })).toHaveAttribute('href', 'http://localhost:3070/');
    const assistant = screen.getByRole('button', { name: 'Trợ lý' });
    expect(assistant).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(assistant);
    expect(getShell().assistantOpen).toBe(true);
    expect(assistant).toHaveAttribute('aria-pressed', 'true');
  });
});
