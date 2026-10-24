import { CircleAlert } from 'lucide-react';
import { TextField } from '../../../shared/ui/TextField';
import type { FieldOption } from '../model/useAttributeFormPresenter';

export interface AttributeFieldViewProps {
  column: string;
  label: string;
  value: string;
  error?: string;
  /** Shown but not editable (a read-only form). */
  disabled?: boolean;
  /** The display unit's symbol, shown after the input. */
  unitSymbol?: string;
  /** A list of values: a select instead of a text input. */
  options?: FieldOption[];
  /** Without it a select offers an empty choice. */
  required?: boolean;
  onChange: (v: string) => void;
}

// Passive: one attribute field — dictionary label + text input (with its unit) or value select.
export function AttributeFieldView({
  column, label, value, error, disabled, unitSymbol, options, required, onChange,
}: AttributeFieldViewProps) {
  const id = `attr-${column}`;
  if (options) {
    const errorId = `${id}-error`;
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          className="input"
          value={value}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {!required && <option value="">—</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {error && (
          <p id={errorId} className="hint bad" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    );
  }
  const unitId = `${id}-unit`;
  return (
    <TextField
      id={id}
      label={label}
      value={value}
      error={error}
      disabled={disabled}
      aria-describedby={unitSymbol ? unitId : undefined}
      trailing={unitSymbol ? <span id={unitId} className="attr-unit">{unitSymbol}</span> : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
