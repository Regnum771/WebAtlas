import type { AdminUser } from '../api/users.api';
import { ROLE_LABELS } from '../../../entities/session/model/roleLabels';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';

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
    <div className="user-mgmt">
      <div className="user-mgmt-header">
        <h2>Người dùng</h2>
        {adminActions && <Button variant="solid" onClick={onNew}>Thêm người dùng</Button>}
      </div>
      {listError && <Message tone="error" title={listError} actions={<Button onClick={onRetry}>Thử lại</Button>} />}
      {groupsError && <Message tone="error" title="Không tải được danh sách nhóm quyền." actions={<Button onClick={onRetryGroups}>Thử lại</Button>} />}
      {loading ? (
        <Spinner label="Đang tải" />
      ) : !listError && users.length === 0 ? (
        <p>Chưa có người dùng nào.</p>
      ) : users.length > 0 ? (
        <table className="user-table">
          <thead>
            <tr><th>Email</th><th>Họ tên</th><th>Vai trò</th><th>Nhóm</th><th>Phạm vi thực tế</th><th>Trạng thái</th><th className="col-created">Ngày tạo</th><th>Thao tác</th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = !canModify(u);
              const title = locked ? 'Không tự đổi quyền của chính mình được' : undefined;
              return (
                <tr key={u.id}>
                  <td className="col-email">{u.email}</td>
                  <td>{u.full_name ?? '—'}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>{u.groups.length > 0 ? u.groups.map((g) => g.name).join(', ') : '—'}</td>
                  <td className="col-scope">
                    {summaryFor(u).map((line) => <div key={line}>{line}</div>)}
                  </td>
                  <td>
                    <span className={u.is_active ? 'badge on' : 'badge'}>
                      {u.is_active ? 'Đang hoạt động' : 'Đã khoá'}
                    </span>
                  </td>
                  <td className="col-created">{u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—'}</td>
                  <td>
                    <div className="user-actions">
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
      ) : null}
    </div>
  );
}
