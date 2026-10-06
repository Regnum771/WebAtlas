import { AttributeFieldView } from './AttributeField.view';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';

export interface AttributeFormViewProps {
  attributes: string[];
  labels: Record<string, string>;
  values: Record<string, string>;
  fieldErrors: Record<string, string>;
  error: string | null;
  canSave: boolean;
  saving: boolean;
  onField: (column: string, v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Passive: maps a layer's attributes to a list of AttributeFieldView.
export function AttributeFormView(props: AttributeFormViewProps) {
  const { attributes, labels, values, fieldErrors, error, canSave, saving, onField, onSubmit, onCancel } = props;
  return (
    <form className="edit-attr-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {attributes.map((col) => (
        <AttributeFieldView
          key={col}
          column={col}
          label={labels[col] ?? col}
          value={values[col] ?? ''}
          error={fieldErrors[col]}
          onChange={(v) => onField(col, v)}
        />
      ))}
      {error && <Message tone="error" title={error} />}
      <div className="edit-form-actions">
        {/* A saving button stays enabled so it keeps focus; Button swallows the second press. */}
        <Button type="submit" variant="solid" busy={saving} busyLabel="Đang lưu" disabled={!canSave && !saving}>Lưu</Button>
        <Button onClick={onCancel}>Huỷ</Button>
      </div>
    </form>
  );
}
