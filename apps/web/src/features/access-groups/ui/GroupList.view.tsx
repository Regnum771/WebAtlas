import { PERMISSION_LABELS, type UnitTree } from '@webatlas/shared';
import type { AccessGroup } from '../api/accessGroups.api';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';

export function GroupListView({ groups, tree, loading, listError, onRetry, onNew, onEdit, onDelete }: {
  groups: AccessGroup[];
  tree: UnitTree | null;
  loading: boolean;
  listError: string | null;
  onRetry: () => void;
  onNew: () => void;
  onEdit: (g: AccessGroup) => void;
  onDelete: (g: AccessGroup) => void;
}) {
  const unitName = (code: string) => tree?.get(code)?.name ?? code;
  return (
    <div className="user-mgmt">
      <div className="user-mgmt-header">
        <h2>Nhóm quyền</h2>
        <Button variant="solid" onClick={onNew}>Tạo nhóm</Button>
      </div>
      {listError && (
        <Message tone="error" title={listError} actions={<Button onClick={onRetry}>Thử lại</Button>} />
      )}
      {loading ? (
        <Spinner label="Đang tải" />
      ) : !listError && groups.length === 0 ? (
        <p>Chưa có nhóm nào.</p>
      ) : groups.length > 0 ? (
        <table className="user-table">
          <thead>
            <tr><th>Tên nhóm</th><th>Đơn vị</th><th>Quyền</th><th>Thành viên</th><th>Thao tác</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>{g.name}{g.description && <div className="hint">{g.description}</div>}</td>
                <td>{g.units.map(unitName).join(', ')}</td>
                <td>{g.permissions.map((p) => PERMISSION_LABELS[p]).join(', ')}</td>
                <td>{g.memberCount}</td>
                <td>
                  <div className="user-actions">
                    <Button size="sm" onClick={() => onEdit(g)}>Sửa</Button>
                    <Button size="sm" onClick={() => onDelete(g)}>Xoá</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
