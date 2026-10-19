import type { UnitTree } from '@webatlas/shared';
import { useUnitTreeStatus } from '../../../entities/session/model/useUnitTree';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { useUnitPicker } from '../model/useUnitPicker';
import { UnitPickerView } from './UnitPicker.view';

export const UNIT_TREE_FAILED = 'Không tải được danh sách đơn vị hành chính.';

/**
 * Picks units from the tree. `multi` honours ancestor coverage; `single` picks exactly one,
 * and once a unit is chosen it always holds exactly one unit (re-picking replaces it).
 */
export function UnitPicker({ tree, selected, onChange, mode = 'multi', allowed, error, hint }: {
  tree: UnitTree | null;
  selected: string[];
  onChange: (next: string[]) => void;
  mode?: 'multi' | 'single';
  allowed?: (code: string) => boolean;
  error?: string | null;
  hint?: string | null;
}) {
  const p = useUnitPicker(tree, selected, { onChange, mode, allowed });
  // Every picker (Nhóm quyền, Đơn vị chủ quản, Gán đơn vị) draws from the one tree request: a
  // failed load says so, instead of an empty list.
  const treeStatus = useUnitTreeStatus();
  if (tree === null && treeStatus.status === 'error') {
    return <Message tone="error" title={UNIT_TREE_FAILED} actions={<Button onClick={treeStatus.retry}>Thử lại</Button>} />;
  }
  return (
    <UnitPickerView rows={p.rows} query={p.query} onQuery={p.setQuery} onToggle={p.toggle}
      onToggleExpand={p.toggleExpand} selectedItems={p.selectedItems} mode={mode} error={error} hint={hint} />
  );
}
