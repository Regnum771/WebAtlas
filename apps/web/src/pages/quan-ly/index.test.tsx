import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { buildUnitTree, type Grant } from '@webatlas/shared';

let mock: { status: string; currentUser: Record<string, unknown> | null };
let mockTree: ReturnType<typeof buildUnitTree> | null;
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => mock }));
let mockStatus: 'loading' | 'error' | 'ready';
const retry = vi.fn();
vi.mock('../../entities/session/model/useUnitTree', () => ({
  useUnitTree: () => mockTree,
  useUnitTreeStatus: () => ({ status: mockStatus, retry }),
}));

import QuanLyRoute from './index';

const TREE = buildUnitTree([
  { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
  { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
]);
const signedIn = (isAdmin: boolean, ...grants: Grant[]) => ({
  status: 'authenticated',
  currentUser: { id: '1', email: 'a@b.test', role: isAdmin ? 'admin' : 'viewer', isAdmin, grants },
});

beforeEach(() => { mock = { status: 'anonymous', currentUser: null }; mockTree = TREE; mockStatus = 'ready'; retry.mockClear(); });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>MAP_HOME</div>} />
        <Route path="/quan-ly" element={<QuanLyRoute />}>
          <Route path="nhom-quyen" element={<div>SEC_NHOM</div>} />
          <Route path="nguoi-dung" element={<div>SEC_NGUOI</div>} />
          <Route path="chua-gan" element={<div>SEC_CHUA</div>} />
          <Route path="ban-do-ca-nhan" element={<div>SEC_BDCN</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

const links = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('QuanLyRoute', () => {
  it('shows Người dùng at once to a users.manage + province feature.update user while the tree loads', () => {
    mock = signedIn(false, { permission: 'users.manage', unit: '48' }, { permission: 'feature.update', unit: '48' });
    mockTree = null; mockStatus = 'loading';
    renderAt('/quan-ly');
    expect(links()).toEqual(['Người dùng']);
    expect(screen.getByText('SEC_NGUOI')).toBeInTheDocument();
  });

  it('a tree failure shows a message with Thử lại, not an endless spinner or a redirect', async () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' }, { permission: 'submission.review', unit: 'VN' });
    mockTree = null; mockStatus = 'error';
    renderAt('/quan-ly');
    expect(screen.queryByText('MAP_HOME')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Đang tải…' })).toBeNull();
    expect(screen.getByText('Không tải được danh sách đơn vị hành chính.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the visible items beside the failure message', () => {
    mock = signedIn(false, { permission: 'users.manage', unit: '48' }, { permission: 'feature.update', unit: '48' },
      { permission: 'submission.review', unit: '48' });
    mockTree = null; mockStatus = 'error';
    renderAt('/quan-ly');
    expect(screen.getByText('SEC_NGUOI')).toBeInTheDocument();
    expect(screen.getByText('Không tải được danh sách đơn vị hành chính.')).toBeInTheDocument();
  });

  it('shows all four sub-nav items to admin and lands on Nhóm quyền', () => {
    mock = signedIn(true);
    renderAt('/quan-ly');
    expect(links()).toEqual(['Nhóm quyền', 'Người dùng', 'Đơn vị chưa gán', 'Bản đồ cá nhân']);
    expect(screen.getByText('SEC_NHOM')).toBeInTheDocument();
  });

  it('a users.manage holder sees only Người dùng and lands on it', () => {
    mock = signedIn(false, { permission: 'users.manage', unit: '48' });
    renderAt('/quan-ly');
    expect(links()).toEqual(['Người dùng']);
    expect(screen.getByText('SEC_NGUOI')).toBeInTheDocument();
  });

  it('a holder of feature.update and submission.review on VN sees Đơn vị chưa gán', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' }, { permission: 'submission.review', unit: 'VN' });
    renderAt('/quan-ly');
    expect(links()).toEqual(['Đơn vị chưa gán']);
    expect(screen.getByText('SEC_CHUA')).toBeInTheDocument();
  });

  // Assigning publishes at once until P4, so the page needs the review right on VN too.
  it('a Bộ officer with feature.update on VN but no review right does not see Đơn vị chưa gán', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' });
    renderAt('/quan-ly/chua-gan');
    expect(screen.queryByText('SEC_CHUA')).toBeNull();
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
  });

  it('review on a province only does not open Đơn vị chưa gán', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' }, { permission: 'submission.review', unit: '48' });
    renderAt('/quan-ly/chua-gan');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
  });

  it('a Bộ officer without review rights is not left waiting while the tree loads', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' });
    mockTree = null; mockStatus = 'loading';
    renderAt('/quan-ly/chua-gan');
    expect(screen.getByText('MAP_HOME')).toBeInTheDocument();
  });

  it('does not bounce a VN officer away while the unit tree is still loading', () => {
    mock = signedIn(false, { permission: 'feature.update', unit: 'VN' }, { permission: 'submission.review', unit: 'VN' });
    mockTree = null; mockStatus = 'loading';
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

  it('the nav entry and the route are admin-only', () => {
    mock = signedIn(true);
    const { unmount } = renderAt('/quan-ly/ban-do-ca-nhan');
    expect(links()).toContain('Bản đồ cá nhân');
    expect(screen.getByText('SEC_BDCN')).toBeInTheDocument();
    unmount();
    mock = signedIn(false, { permission: 'users.manage', unit: '48' });
    renderAt('/quan-ly/ban-do-ca-nhan');
    expect(links()).toEqual(['Người dùng']);
    expect(screen.queryByText('SEC_BDCN')).toBeNull();
    expect(screen.getByText('SEC_NGUOI')).toBeInTheDocument();
  });
});
