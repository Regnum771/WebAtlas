import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { buildUnitTree, type Grant } from '@webatlas/shared';

let mock: { status: string; currentUser: Record<string, unknown> | null };
let mockTree: ReturnType<typeof buildUnitTree> | null;
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => mock }));
vi.mock('../../entities/session/model/useUnitTree', () => ({ useUnitTree: () => mockTree }));

import QuanLyRoute from './index';

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
]);
const signedIn = (isAdmin: boolean, ...grants: Grant[]) => ({
  status: 'authenticated',
  currentUser: { id: '1', email: 'a@b.test', role: isAdmin ? 'admin' : 'viewer', isAdmin, grants },
});

beforeEach(() => { mock = { status: 'anonymous', currentUser: null }; mockTree = TREE; });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>MAP_HOME</div>} />
        <Route path="/quan-ly" element={<QuanLyRoute />}>
          <Route path="nhom-quyen" element={<div>SEC_NHOM</div>} />
          <Route path="nguoi-dung" element={<div>SEC_NGUOI</div>} />
          <Route path="chua-gan" element={<div>SEC_CHUA</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

const links = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('QuanLyRoute', () => {
  it('shows all three sub-nav items to admin and lands on Nhóm quyền', () => {
    mock = signedIn(true);
    renderAt('/quan-ly');
    expect(links()).toEqual(['Nhóm quyền', 'Người dùng', 'Đơn vị chưa gán']);
    expect(screen.getByText('SEC_NHOM')).toBeInTheDocument();
  });

  it('a users.manage holder sees only Người dùng and lands on it', () => {
    mock = signedIn(false, { permission: 'users.manage', unit: '48' });
    renderAt('/quan-ly');
    expect(links()).toEqual(['Người dùng']);
    expect(screen.getByText('SEC_NGUOI')).toBeInTheDocument();
  });

  it('a feature.update holder on VN sees Đơn vị chưa gán', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' });
    renderAt('/quan-ly');
    expect(links()).toEqual(['Đơn vị chưa gán']);
    expect(screen.getByText('SEC_CHUA')).toBeInTheDocument();
  });

  it('does not bounce a VN officer away while the unit tree is still loading', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' });
    mockTree = null;
    renderAt('/quan-ly/chua-gan');
    expect(screen.queryByText('MAP_HOME')).toBeNull();
    expect(screen.getByRole('status', { name: 'Đang tải…' })).toBeInTheDocument();
  });

  it('redirects a reader and a visitor to /', () => {
    mock = signedIn(false);
    const { unmount } = renderAt('/quan-ly');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
    unmount();
    mock = { status: 'anonymous', currentUser: null };
    renderAt('/quan-ly/nguoi-dung');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
  });

  it('sends a user who opens a section they may not see to their first item', () => {
    mock = signedIn(false, { permission: 'users.manage', unit: '48' });
    renderAt('/quan-ly/nhom-quyen');
    expect(screen.queryByText('SEC_NHOM')).toBeNull();
    expect(screen.getByText('SEC_NGUOI')).toBeInTheDocument();
  });

  it('decides nothing while the stored session is still resolving', () => {
    mock = { status: 'authenticating', currentUser: null };
    renderAt('/quan-ly/nguoi-dung');
    expect(screen.queryByText('MAP_HOME')).toBeNull();
  });
});
