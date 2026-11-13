import { PERMISSION_LABELS, type UnitTree } from '@webatlas/shared';
import type { AccessGroup } from '../api/accessGroups.api';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { ui } from '../../../shared/ui/styles';

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
    <section data-slot="admin-section" aria-labelledby="nhom-quyen" className={ui.section}>
      <div className={ui.head}>
        <h2 id="nhom-quyen" className={ui.title}>Nhóm quyền</h2>
        <Button variant="solid" onClick={onNew}>Tạo nhóm</Button>
      </div>
      {listError && (
        <Message tone="error" title={listError} actions={<Button onClick={onRetry}>Thử lại</Button>} />
      )}
      {loading ? (
        <Spinner label="Đang tải" />
      ) : !listError && groups.length === 0 ? (
        <p className={ui.hint}>Chưa có nhóm nào.</p>
      ) : groups.length > 0 ? (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead className={ui.thead}>
              <tr>
                <th scope="col" className={ui.th}>Tên nhóm</th>
                <th scope="col" className={ui.th}>Đơn vị</th>
                <th scope="col" className={ui.th}>Quyền</th>
                <th scope="col" className={`${ui.th} text-right`}>Thành viên</th>
                <th scope="col" className={ui.th}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className={ui.tr}>
                  <td className={ui.td}>
                    <span className="font-semibold">{g.name}</span>
                    {g.description && <div className={`${ui.hint} text-label`}>{g.description}</div>}
                  </td>
                  <td className={ui.td}>{g.units.map(unitName).join(', ')}</td>
                  <td className={`${ui.td} text-ink-2`}>{g.permissions.map((p) => PERMISSION_LABELS[p]).join(', ')}</td>
                  <td className={`${ui.td} text-right font-num text-num`}>{g.memberCount}</td>
                  <td className={ui.td}>
                    <div className={ui.actions}>
                      <Button size="sm" onClick={() => onEdit(g)}>Sửa</Button>
                      <Button size="sm" onClick={() => onDelete(g)}>Xoá</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
