import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TopBarView } from './TopBar.view';

const renderView = (role: 'admin' | 'editor' | 'viewer', onLogout = vi.fn()) =>
  render(
    <MemoryRouter>
      <TopBarView email="a@b.test" role={role} onLogout={onLogout} />
    </MemoryRouter>
  );

describe('TopBarView', () => {
  it('shows the user email', () => {
    renderView('editor');
    expect(screen.getByText('a@b.test')).toBeInTheDocument();
  });

  it('shows Manage users for an admin, linking to /admin/users', () => {
    renderView('admin');
    const link = screen.getByRole('link', { name: /manage users/i });
    expect(link).toHaveAttribute('href', '/admin/users');
  });

  it('hides Manage users from an editor', () => {
    renderView('editor');
    expect(screen.queryByRole('link', { name: /manage users/i })).not.toBeInTheDocument();
  });

  it('hides Manage users from a viewer', () => {
    renderView('viewer');
    expect(screen.queryByRole('link', { name: /manage users/i })).not.toBeInTheDocument();
  });

  it('calls onLogout when Log out is clicked', async () => {
    const onLogout = vi.fn();
    renderView('viewer', onLogout);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(onLogout).toHaveBeenCalled();
  });
});
