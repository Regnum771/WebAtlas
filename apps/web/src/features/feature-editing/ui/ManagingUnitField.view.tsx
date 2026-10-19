import { UnitPicker } from '../../access-groups';
import type { ManagingUnitFieldState } from '../model/useManagingUnitField';

export const MANAGING_UNIT_LABEL = 'Đơn vị chủ quản';

/** Passive: "Đơn vị chủ quản" as a single-select unit picker, or plain text when the unit is out of scope. */
export function ManagingUnitFieldView({ field, error }: {
  field: ManagingUnitFieldState;
  /** A server-side field error; wins over the field's own. */
  error?: string | null;
}) {
  return (
    <div className="managing-unit-field">
      <p className="field-label"><b>{MANAGING_UNIT_LABEL}</b></p>
      {field.readOnlyText ? (
        <p>{field.readOnlyText}</p>
      ) : (
        <UnitPicker tree={field.tree} selected={field.value ? [field.value] : []} mode="single"
          onChange={(next) => field.setValue(next[0] ?? '')} allowed={field.allowed}
          error={error ?? field.error} hint={field.hint} />
      )}
    </div>
  );
}
