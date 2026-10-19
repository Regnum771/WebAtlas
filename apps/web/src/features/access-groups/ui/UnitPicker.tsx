import type { UnitTree } from '@webatlas/shared';
import { useUnitPicker } from '../model/useUnitPicker';
import { UnitPickerView } from './UnitPicker.view';

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
  return (
    <UnitPickerView rows={p.rows} query={p.query} onQuery={p.setQuery} onToggle={p.toggle}
      onToggleExpand={p.toggleExpand} selectedItems={p.selectedItems} mode={mode} error={error} hint={hint} />
  );
}
