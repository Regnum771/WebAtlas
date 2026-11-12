import { PERMISSION_LABELS, type UnitTree } from '@webatlas/shared';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import type { AccessGroup } from '../../access-groups/api/accessGroups.api';

export const OUT_OF_SCOPE_HINT = 'Ngoài phạm vi quản lý của anh/chị';

export function UserGroupsDialogView({ open, userLabel, groups, tree, selected, saving, error, canHandOver, groupsLoading = false, groupsError = false,
  onToggle, onSubmit, onClose }: {
  open: boolean;
  userLabel: string;
  groups: AccessGroup[];
  tree: UnitTree | null;
  selected: string[];
  saving: boolean;
  error: string | null;
  groupsLoading?: boolean;
  groupsError?: boolean;
  canHandOver: (g: AccessGroup) => boolean;
  onToggle: (groupId: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const unitName = (code: string) => tree?.get(code)?.name ?? code;
  return (
    <Dialog open={open} title={`Nhóm của ${userLabel}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="user-form group-form">
        {groupsLoading ? (
          <Spinner label="Đang tải" />
        ) : groupsError ? (
          <Message tone="error" title="Không tải được danh sách nhóm quyền." />
        ) : groups.length === 0 ? (
          <p>Chưa có nhóm nào.</p>
        ) : (
          <fieldset className="group-form-set">
            <legend>Nhóm quyền</legend>
            {groups.map((g) => {
              const allowed = canHandOver(g);
              return (
                <label key={g.id} title={allowed ? undefined : OUT_OF_SCOPE_HINT}>
                  <input type="checkbox" checked={selected.includes(g.id)} disabled={!allowed}
                    onChange={() => onToggle(g.id)} />
                  {' '}{g.name}
                  <span className="hint">
                    {' '}({g.units.map(unitName).join(', ')}; {g.permissions.map((p) => PERMISSION_LABELS[p]).join(', ')})
                  </span>
                  {!allowed && <span className="hint">{' '}{OUT_OF_SCOPE_HINT}</span>}
                </label>
              );
            })}
          </fieldset>
        )}
        {error && <Message tone="error" title={error} />}
        <div className="user-form-actions">
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={saving} disabled={groupsLoading || groupsError}>Lưu</Button>
        </div>
      </form>
    </Dialog>
  );
}
