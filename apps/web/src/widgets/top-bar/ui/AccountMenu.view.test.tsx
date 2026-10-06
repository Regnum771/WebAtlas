import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountMenuView } from './AccountMenu.view';
import type { Role } from '../../../entities/session/model/session.types';

const renderMenu = (role: Role, onLogout = vi.fn(), email = 'a@b.test') =>
  render(<MemoryRouter><AccountMenuView email={email} role={role} onLogout={onLogout} /></MemoryRouter>);

describe('AccountMenuView', () => {
  it('shows the role on the button, not the email', () => {
    renderMenu('admin');
    const button = screen.getByRole('button', { name: 'Quản trị viên' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('a@b.test')).toBeNull();
  });

  it('offers Người dùng to an admin only', async () => {
    const user = userEvent.setup();
    const { unmount } = renderMenu('admin');
    await user.click(screen.getByRole('button', { name: 'Quản trị viên' }));
    expect(screen.getByRole('menuitem', { name: 'Người dùng' })).toHaveAttribute('href', '/admin/users');
    unmount();
    renderMenu('editor');
    await user.click(screen.getByRole('button', { name: 'Biên tập viên' }));
    expect(screen.queryByRole('menuitem', { name: 'Người dùng' })).toBeNull();
  });

  it('Đăng xuất calls onLogout', async () => {
    const onLogout = vi.fn();
    renderMenu('viewer', onLogout);
    await userEvent.click(screen.getByRole('button', { name: 'Người xem' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đăng xuất' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the menu and returns focus to the button', async () => {
    const user = userEvent.setup();
    renderMenu('viewer');
    const button = screen.getByRole('button', { name: 'Người xem' });
    await user.click(button);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a press outside and returns focus to the button', async () => {
    const user = userEvent.setup();
    renderMenu('viewer');
    const button = screen.getByRole('button', { name: 'Người xem' });
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('keeps the whole address available when it is cut short', async () => {
    const email = 'nguyen.thi.minh.khai.phong.tai.nguyen.nuoc@monre.example.vn';
    renderMenu('viewer', vi.fn(), email);
    expect(screen.queryByText(email)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Người xem' }));
    expect(screen.getByText(email)).toHaveAttribute('title', email);
  });
});
