import { AttributeFieldView } from './AttributeField.view';
import { ManagingUnitFieldView } from './ManagingUnitField.view';
import type { ManagingUnitFieldState } from '../model/useManagingUnitField';
import type { FieldInfo } from '../model/useAttributeFormPresenter';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';

export interface AttributeFormViewProps {
  attributes: string[];
  labels: Record<string, string>;
  values: Record<string, string>;
  /** Per column: the display unit's symbol, or the values a select offers. */
  fields?: Record<string, FieldInfo>;
  fieldErrors: Record<string, string>;
  error: string | null;
  /** A second line under the error, e.g. the missing review right of a refusal. */
  errorDetail?: string | null;
  canSave: boolean;
  saving: boolean;
  /** The managing_unit attribute renders as this field instead of a text input. */
  managingUnit?: ManagingUnitFieldState;
  /** Shown for reading only: inputs disabled, no buttons (a shared personal map's recipient). */
  readOnly?: boolean;
  onField: (column: string, v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Passive: maps a layer's attributes to a list of AttributeFieldView.
export function AttributeFormView(props: AttributeFormViewProps) {
  const {
    attributes, labels, values, fields, fieldErrors, error, errorDetail, canSave, saving, managingUnit, readOnly, onField, onSubmit, onCancel,
  } = props;
  return (
    <form className="edit-attr-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {attributes.map((col) => (
        col === 'managing_unit' && managingUnit && !readOnly ? (
          <ManagingUnitFieldView key={col} field={managingUnit} error={fieldErrors[col]} />
        ) : (
          <AttributeFieldView
            key={col}
            column={col}
            label={labels[col] ?? col}
            value={values[col] ?? ''}
            error={fieldErrors[col]}
            disabled={readOnly}
            unitSymbol={fields?.[col]?.unitSymbol}
            options={fields?.[col]?.options}
            onChange={(v) => onField(col, v)}
          />
        )
      ))}
      {error && <Message tone="error" title={error}>{errorDetail}</Message>}
      {!readOnly && (
        <div className="edit-form-actions">
          {/* A saving button stays enabled so it keeps focus; Button swallows the second press. */}
          <Button type="submit" variant="solid" busy={saving} busyLabel="Đang lưu" disabled={!canSave && !saving}>Lưu</Button>
          <Button onClick={onCancel}>Huỷ</Button>
        </div>
      )}
    </form>
  );
}
