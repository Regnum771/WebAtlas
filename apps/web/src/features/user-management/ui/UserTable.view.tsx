import type { AdminUser } from '../api/users.api';
import { ROLE_LABELS } from '../../../entities/session/model/roleLabels';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { ui } from '../../../shared/ui/styles';

const NARROW_HIDDEN = 'hidden min-[1100px]:table-cell';

export function UserTableView({ users, canModify, adminActions, summaryFor, onEdit, onToggleActive, onGroups, onNew, onRetry, loading, listError, groupsError = false, onRetryGroups }: {
  users: AdminUser[];
  canModify: (u: AdminUser) => boolean;
  /** Create, edit-account and lock controls: admin only. Others get just the Nhóm action. */
  adminActions: boolean;
  summaryFor: (u: AdminUser) => string[];
  onEdit: (u: AdminUser) => void;
  onToggleActive: (u: AdminUser) => void;
  onGroups: (u: AdminUser) => void;
  onNew: () => void;
  onRetry: () => void;
  loading: boolean;
  listError: string | null;
  /** The group list failed to load: one message with retry above the table. */
  groupsError?: boolean;
  onRetryGroups?: () => void;
}) {
  return (
    <section data-slot="admin-section" aria-labelledby="nguoi-dung" className={ui.section}>
      <div className={ui.head}>
        <h2 id="nguoi-dung" className={ui.title}>Người dùng</h2>
        {adminActions && <Button variant="solid" onClick={onNew}>Thêm người dùng</Button>}
      </div>
      {listError && <Message tone="error" title={listError} actions={<Button onClick={onRetry}>Thử lại</Button>} />}
      {groupsError && <Message tone="error" title="Không tải được danh sách nhóm quyền." actions={<Button onClick={onRetryGroups}>Thử lại</Button>} />}
      {loading ? (
        <Spinner label="Đang tải" />
      ) : !listError && users.length === 0 ? (
        <p className={ui.hint}>Chưa có người dùng nào.</p>
      ) : users.length > 0 ? (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead className={ui.thead}>
              <tr>
                <th scope="col" className={ui.th}>Email</th>
                <th scope="col" className={ui.th}>Họ tên</th>
                <th scope="col" className={ui.th}>Vai trò</th>
                <th scope="col" className={ui.th}>Nhóm</th>
                <th scope="col" className={ui.th}>Phạm vi thực tế</th>
                <th scope="col" className={ui.th}>Trạng thái</th>
                {/* Below 1100 px Ngày tạo gives way, so Thao tác stays in view. */}
                <th scope="col" className={`${ui.th} ${NARROW_HIDDEN}`}>Ngày tạo</th>
                <th scope="col" className={ui.th}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const locked = !canModify(u);
                const title = locked ? 'Không tự đổi quyền của chính mình được' : undefined;
                return (
                  <tr key={u.id} className={ui.tr}>
                    <td className={`${ui.td} [overflow-wrap:anywhere]`}>{u.email}</td>
                    <td className={ui.td}>{u.full_name ?? '—'}</td>
                    <td className={`${ui.td} whitespace-nowrap`}>{ROLE_LABELS[u.role]}</td>
                    <td className={ui.td}>{u.groups.length > 0 ? u.groups.map((g) => g.name).join(', ') : '—'}</td>
                    <td className={`${ui.td} text-ink-2`}>
                      {summaryFor(u).map((line) => <div key={line}>{line}</div>)}
                    </td>
                    <td className={ui.td}>
                      <span className={u.is_active ? ui.tagOn : ui.tag}>{u.is_active ? 'Đang hoạt động' : 'Đã khoá'}</span>
                    </td>
                    <td className={`${ui.td} ${NARROW_HIDDEN} font-num text-num whitespace-nowrap text-ink-2`}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—'}
                    </td>
                    <td className={ui.td}>
                      <div className={ui.actions}>
                        <Button size="sm" onClick={() => onGroups(u)}>Nhóm</Button>
                        {adminActions && (
                          <>
                            <Button size="sm" onClick={() => onEdit(u)} disabled={locked} title={title}>Sửa</Button>
                            <Button size="sm" onClick={() => onToggleActive(u)} disabled={locked} title={title}>
                              {u.is_active ? 'Khoá' : 'Mở khoá'}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
