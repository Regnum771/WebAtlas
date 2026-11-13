import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountMenuView } from './AccountMenu.view';
import type { Role } from '../../../entities/session/model/session.types';

interface Opts { name?: string | null; email?: string; canManageUsers?: boolean; onLogout?: () => void }
const renderMenu = (role: Role, { name = 'Nguyễn Văn An', email = 'a@b.test', canManageUsers = role === 'admin', onLogout = vi.fn() }: Opts = {}) =>
  render(
    <MemoryRouter>
      <AccountMenuView name={name} email={email} role={role} canManageUsers={canManageUsers} onLogout={onLogout} />
    </MemoryRouter>,
  );

describe('AccountMenuView', () => {
  it('shows the account name on the trigger, not the email', () => {
    renderMenu('admin');
    const trigger = screen.getByRole('button', { name: 'Nguyễn Văn An' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('a@b.test')).toBeNull();
  });

  it('falls back to the email when the account has no name', () => {
    renderMenu('viewer', { name: null });
    expect(screen.getByRole('button', { name: 'a@b.test' })).toBeInTheDocument();
    renderMenu('viewer', { name: '  ', email: 'c@d.test' });
    expect(screen.getByRole('button', { name: 'c@d.test' })).toBeInTheDocument();
  });

  it('opens a menu with the email and the role, then the account items', async () => {
    const user = userEvent.setup();
    renderMenu('admin');
    const trigger = screen.getByRole('button', { name: 'Nguyễn Văn An' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('a@b.test');
    expect(menu).toHaveTextContent('Quản trị viên');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Hồ sơ', 'Người dùng', 'Đăng xuất']);
  });

  it('offers Người dùng, pointing into Quản lý, only when canManageUsers', async () => {
    const user = userEvent.setup();
    const first = renderMenu('admin');
    await user.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    expect(screen.getByRole('menuitem', { name: 'Người dùng' })).toHaveAttribute('href', '/quan-ly/nguoi-dung');
    first.unmount();
    const second = renderMenu('viewer', { canManageUsers: true });
    await user.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    expect(screen.getByRole('menuitem', { name: 'Người dùng' })).toHaveAttribute('href', '/quan-ly/nguoi-dung');
    second.unmount();
    renderMenu('viewer');
    await user.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    expect(screen.queryByRole('menuitem', { name: 'Người dùng' })).toBeNull();
  });

  it('offers Hồ sơ to every signed-in user', async () => {
    renderMenu('viewer');
    await userEvent.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    expect(screen.getByRole('menuitem', { name: 'Hồ sơ' })).toHaveAttribute('href', '/ho-so');
  });

  it('Đăng xuất calls onLogout', async () => {
    const onLogout = vi.fn();
    renderMenu('viewer', { onLogout });
    await userEvent.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đăng xuất' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderMenu('viewer');
    const trigger = screen.getByRole('button', { name: 'Nguyễn Văn An' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a long name and the whole address available when they are cut short', async () => {
    const email = 'nguyen.thi.minh.khai.phong.tai.nguyen.nuoc@monre.example.vn';
    renderMenu('viewer', { name: null, email });
    expect(screen.getByRole('button', { name: email }).querySelector('[title]')).toHaveAttribute('title', email);
    await userEvent.click(screen.getByRole('button', { name: email }));
    expect(screen.getByRole('menu').querySelector(`[title="${email}"]`)).not.toBeNull();
  });
});
