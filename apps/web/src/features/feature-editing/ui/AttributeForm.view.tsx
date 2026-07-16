import { AttributeFieldView } from './AttributeField.view';

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
      {error && <p className="edit-form-error" role="alert">{error}</p>}
      <div className="edit-form-actions">
        <button type="submit" disabled={!canSave}>{saving ? 'Saving…' : 'Save feature'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
