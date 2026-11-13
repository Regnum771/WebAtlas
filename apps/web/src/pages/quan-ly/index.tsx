import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../../entities/session/model/session.store';
import { useCan } from '../../entities/session/model/useCan';
import { useUnitTreeStatus } from '../../entities/session/model/useUnitTree';
import { Button } from '../../shared/ui/Button';
import { Message } from '../../shared/ui/Message';
import { Spinner } from '../../shared/ui/Spinner';
import { canSeeBanDoCaNhan, canSeeGroups, canSeeTuDien, canSeeUnassigned, canSeeUsers } from './model/visibility';

const UNASSIGNED = '/quan-ly/chua-gan';
const TU_DIEN = '/quan-ly/tu-dien';

const ITEMS = [
  { to: '/quan-ly/nhom-quyen', label: 'Nhóm quyền', visible: canSeeGroups },
  { to: '/quan-ly/nguoi-dung', label: 'Người dùng', visible: canSeeUsers },
  { to: UNASSIGNED, label: 'Đơn vị chưa gán', visible: canSeeUnassigned },
  { to: '/quan-ly/ban-do-ca-nhan', label: 'Bản đồ cá nhân', visible: canSeeBanDoCaNhan },
  { to: '/quan-ly/tu-dien', label: 'Từ điển dữ liệu', visible: canSeeTuDien },
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
  // Only Đơn vị chưa gán and Từ điển dữ liệu need the tree: a non-admin who could pass a VN check
  // (update and review, or dictionary.manage, held somewhere) is undecided until the tree arrives
  // (or fails). Nhóm quyền and Người dùng never wait.
  const shown = (to: string) => visible.some((item) => item.to === to);
  const mayNeedTree = (can('feature.update') && can('submission.review') && !shown(UNASSIGNED))
    || (can('dictionary.manage') && !shown(TU_DIEN));
  const undecided = !!user && !user.isAdmin && mayNeedTree && (tree.status === 'loading' || tree.status === 'error');
  const failed = undecided && tree.status === 'error';

  const current = pathname.replace(/\/+$/, '');
  const onVisible = visible.some((item) => item.to === current);
  const waitingHere = undecided && (current === UNASSIGNED || current === TU_DIEN);

  if (visible.length === 0 && !undecided) return <Navigate to="/" replace />;
  if (visible.length > 0 && !onVisible && !waitingHere) return <Navigate to={visible[0].to} replace />;

  const retryMessage = (
    <Message tone="error" title="Không tải được danh sách đơn vị hành chính."
      actions={<Button onClick={tree.retry}>Thử lại</Button>} />
  );

  return (
    // .quan-ly-route places the page over the map (and stops it at a docked Trợ lý); the page draws
    // its own ground: the section links beside the content from 1024 px, above it when narrower.
    <div className="quan-ly-route bg-surface-2 p-0">
      <div data-slot="quan-ly" className="mx-auto flex max-w-[1240px] flex-col gap-6 px-6 py-8 text-body text-ink lg:flex-row lg:items-start">
        {visible.length > 0 && (
          <nav aria-label="Quản lý" className="flex shrink-0 flex-wrap gap-1 lg:w-52 lg:flex-col">
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className="flex h-control items-center rounded-md px-3 text-ink-2 no-underline hover:bg-surface hover:text-ink aria-[current=page]:bg-brand-tint aria-[current=page]:font-semibold aria-[current=page]:text-brand"
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {failed && retryMessage}
          {undecided && !failed && (visible.length === 0 || waitingHere) && <Spinner label="Đang tải…" />}
          {onVisible && <Outlet />}
        </div>
      </div>
    </div>
  );
}
