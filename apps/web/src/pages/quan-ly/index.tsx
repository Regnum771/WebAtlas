import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../entities/session/model/session.store';
import { useCan } from '../../entities/session/model/useCan';
import { useUnitTree } from '../../entities/session/model/useUnitTree';
import { Spinner } from '../../shared/ui/Spinner';
import { canSeeGroups, canSeeUnassigned, canSeeUsers } from './model/visibility';

const ITEMS = [
  { to: '/quan-ly/nhom-quyen', label: 'Nhóm quyền', visible: canSeeGroups },
  { to: '/quan-ly/nguoi-dung', label: 'Người dùng', visible: canSeeUsers },
  { to: '/quan-ly/chua-gan', label: 'Đơn vị chưa gán', visible: canSeeUnassigned },
] as const;

// UX gate ONLY. A forced render still gets 401/403 from every API call behind it.
export default function QuanLyRoute() {
  const { status, currentUser } = useSession();
  const can = useCan();
  const tree = useUnitTree();
  const { pathname } = useLocation();

  // Still resolving a stored session: decide nothing yet, or a redirect would fire early.
  if (status === 'authenticating') return null;

  const user = status === 'authenticated' ? currentUser : null;
  // The VN check needs the unit tree, so a non-admin who could pass it waits for the tree
  // instead of being bounced.
  if (user && !user.isAdmin && tree === null && can('feature.update')) {
    return <div className="quan-ly-route"><Spinner label="Đang tải…" /></div>;
  }

  const visible = ITEMS.filter((item) => item.visible(user, can));
  if (visible.length === 0) return <Navigate to="/" replace />;

  const current = pathname.replace(/\/+$/, '');
  if (!visible.some((item) => item.to === current)) return <Navigate to={visible[0].to} replace />;

  return (
    <div className="quan-ly-route">
      <nav aria-label="Quản lý" className="quan-ly-nav">
        {visible.map((item) => (
          <NavLink key={item.to} to={item.to} className="quan-ly-nav-link">{item.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
