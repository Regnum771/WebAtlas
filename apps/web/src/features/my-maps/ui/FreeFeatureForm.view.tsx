import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';
import type { FieldDef } from '../api/workspace.api';

interface Props {
  /** One input per field: text, a number input or a date input. */
  fields: FieldDef[];
  values: Record<string, string>;
  error: string | null;
  saving: boolean;
  /** Shown for reading only: inputs disabled, no buttons (a shared map's recipient). */
  readOnly?: boolean;
  onField: (name: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const INPUT_TYPE: Record<FieldDef['type'], string> = { text: 'text', number: 'number', date: 'date' };

/** Passive: the form of a feature in a free (drawn or imported) layer of a personal map. */
export function FreeFeatureFormView({ fields, values, error, saving, readOnly = false, onField, onSubmit, onCancel }: Props) {
  return (
    <form className="edit-attr-form" onSubmit={(e) => { e.preventDefault(); if (!readOnly) onSubmit(); }}>
      {fields.map((field, i) => (
        <TextField
          key={field.name}
          id={`free-field-${i}`}
          label={field.name}
          type={INPUT_TYPE[field.type]}
          step={field.type === 'number' ? 'any' : undefined}
          value={values[field.name] ?? ''}
          disabled={readOnly}
          onChange={(e) => onField(field.name, e.target.value)}
        />
      ))}
      {error && <Message tone="error" title={error} />}
      {!readOnly && (
        <div className="edit-form-actions">
          <Button type="submit" variant="solid" busy={saving} busyLabel="Đang lưu">Lưu</Button>
          <Button onClick={onCancel}>Huỷ</Button>
        </div>
      )}
    </form>
  );
}
