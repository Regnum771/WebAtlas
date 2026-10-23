import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../entities/session/model/session.store';
import { useCan } from '../../entities/session/model/useCan';
import { useUnitTreeStatus } from '../../entities/session/model/useUnitTree';
import { Button } from '../../shared/ui/Button';
import { Message } from '../../shared/ui/Message';
import { Spinner } from '../../shared/ui/Spinner';
import { canSeeBanDoCaNhan, canSeeGroups, canSeeUnassigned, canSeeUsers } from './model/visibility';

const UNASSIGNED = '/quan-ly/chua-gan';

const ITEMS = [
  { to: '/quan-ly/nhom-quyen', label: 'Nhóm quyền', visible: canSeeGroups },
  { to: '/quan-ly/nguoi-dung', label: 'Người dùng', visible: canSeeUsers },
  { to: UNASSIGNED, label: 'Đơn vị chưa gán', visible: canSeeUnassigned },
  { to: '/quan-ly/ban-do-ca-nhan', label: 'Bản đồ cá nhân', visible: canSeeBanDoCaNhan },
] as const;

// UX gate ONLY. A forced render still gets 401/403 from every API call behind it.
export default function QuanLyRoute() {
  const { status, currentUser } = useSession();
  const can = useCan();
  const tree = useUnitTreeStatus();
  const { pathname } = useLocation();

  // Still resolving a stored session: decide nothing yet, or a redirect would fire early.
  if (status === 'authenticating') return null;

  const user = status === 'authenticated' ? currentUser : null;
  const visible = ITEMS.filter((item) => item.visible(user, can));
  // Only Đơn vị chưa gán needs the tree: a non-admin who could pass its VN check (update and
  // review held somewhere) is undecided until the tree arrives (or fails). Nhóm quyền and
  // Người dùng never wait.
  const undecided = !!user && !user.isAdmin && can('feature.update') && can('submission.review')
    && !visible.some((item) => item.to === UNASSIGNED) && (tree.status === 'loading' || tree.status === 'error');
  const failed = undecided && tree.status === 'error';

  const current = pathname.replace(/\/+$/, '');
  const onVisible = visible.some((item) => item.to === current);
  const waitingHere = undecided && current === UNASSIGNED;

  if (visible.length === 0 && !undecided) return <Navigate to="/" replace />;
  if (visible.length > 0 && !onVisible && !waitingHere) return <Navigate to={visible[0].to} replace />;

  const retryMessage = (
    <Message tone="error" title="Không tải được danh sách đơn vị hành chính."
      actions={<Button onClick={tree.retry}>Thử lại</Button>} />
  );

  return (
    <div className="quan-ly-route">
      {visible.length > 0 && (
        <nav aria-label="Quản lý" className="quan-ly-nav">
          {visible.map((item) => (
            <NavLink key={item.to} to={item.to} className="quan-ly-nav-link">{item.label}</NavLink>
          ))}
        </nav>
      )}
      {failed && retryMessage}
      {undecided && !failed && (visible.length === 0 || waitingHere) && <Spinner label="Đang tải…" />}
      {onVisible && <Outlet />}
    </div>
  );
}
