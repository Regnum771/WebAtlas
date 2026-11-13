import { PERMISSION_LABELS, type UnitTree } from '@webatlas/shared';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import type { AccessGroup } from '../../access-groups/api/accessGroups.api';
import { ui } from '../../../shared/ui/styles';

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
      <form data-slot="group-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className={ui.form}>
        {groupsLoading ? (
          <Spinner label="Đang tải" />
        ) : groupsError ? (
          <Message tone="error" title="Không tải được danh sách nhóm quyền." />
        ) : groups.length === 0 ? (
          <p className={ui.hint}>Chưa có nhóm nào.</p>
        ) : (
          <fieldset className={ui.fieldset}>
            <legend className={ui.legend}>Nhóm quyền</legend>
            {groups.map((g) => {
              const allowed = canHandOver(g);
              return (
                <label key={g.id} title={allowed ? undefined : OUT_OF_SCOPE_HINT} className={ui.check}>
                  <input type="checkbox" checked={selected.includes(g.id)} disabled={!allowed}
                    onChange={() => onToggle(g.id)} />
                  <span>
                    <span className="font-semibold">{g.name}</span>
                    <span className={`${ui.hint} block text-label`}>
                      {g.units.map(unitName).join(', ')}; {g.permissions.map((p) => PERMISSION_LABELS[p]).join(', ')}
                    </span>
                    {!allowed && <span className={`${ui.hint} block text-label`}>{OUT_OF_SCOPE_HINT}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {error && <Message tone="error" title={error} />}
        <div className={ui.formActions}>
          <Button onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="solid" busy={saving} disabled={groupsLoading || groupsError}>Lưu</Button>
        </div>
      </form>
    </Dialog>
  );
}
