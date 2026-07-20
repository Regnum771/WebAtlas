import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let mockRole: string | null = null;
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({
    status: mockRole ? 'authenticated' : 'anonymous',
    currentUser: mockRole ? { id: '1', email: 'a@b.test', full_name: 'A', role: mockRole } : null,
  }),
}));
vi.mock('../../features/user-management', () => ({
  UserManagementPanel: () => <div>USER_MGMT_PANEL</div>,
}));

import AdminUsersRoute from './index';

beforeEach(() => { mockRole = null; });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>MAP_HOME</div>} />
        <Route path="/admin/users" element={<AdminUsersRoute />} />
      </Routes>
    </MemoryRouter>
  );

describe('AdminUsersRoute', () => {
  it('renders the panel for an admin', () => {
    mockRole = 'admin';
    renderAt('/admin/users');
    expect(screen.getByText('USER_MGMT_PANEL')).toBeInTheDocument();
  });

  it('redirects an editor to /', () => {
    mockRole = 'editor';
    renderAt('/admin/users');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
    expect(screen.queryByText('USER_MGMT_PANEL')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to /', () => {
    mockRole = null;
    renderAt('/admin/users');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
  });
});
