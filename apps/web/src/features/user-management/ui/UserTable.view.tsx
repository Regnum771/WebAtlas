import type { AdminUser } from '../api/users.api';
import { ROLE_LABELS } from '../../../entities/session/model/roleLabels';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';

export function UserTableView({ users, canModify, onEdit, onToggleActive, onNew, loading, listError }: {
  users: AdminUser[];
  canModify: (u: AdminUser) => boolean;
  onEdit: (u: AdminUser) => void;
  onToggleActive: (u: AdminUser) => void;
  onNew: () => void;
  loading: boolean;
  listError: string | null;
}) {
  return (
    <div className="user-mgmt">
      <div className="user-mgmt-header">
        <h2>Người dùng</h2>
        <Button variant="solid" onClick={onNew}>Thêm người dùng</Button>
      </div>
      {listError && <Message tone="error" title={listError} />}
      {loading ? (
        <Spinner label="Đang tải" />
      ) : (
        <table className="user-table">
          <thead>
            <tr><th>Email</th><th>Họ tên</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = !canModify(u);
              const title = locked ? 'Không tự đổi quyền của chính mình được' : undefined;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.full_name ?? '—'}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>
                    <span className={u.is_active ? 'badge on' : 'badge'}>
                      {u.is_active ? 'Đang hoạt động' : 'Đã khoá'}
                    </span>
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '—'}</td>
                  <td>
                    <div className="user-actions">
                      <Button size="sm" onClick={() => onEdit(u)} disabled={locked} title={title}>Sửa</Button>
                      <Button size="sm" onClick={() => onToggleActive(u)} disabled={locked} title={title}>
                        {u.is_active ? 'Khoá' : 'Mở khoá'}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
