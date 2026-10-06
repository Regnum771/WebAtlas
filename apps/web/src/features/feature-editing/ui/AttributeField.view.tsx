import { TextField } from '../../../shared/ui/TextField';

export interface AttributeFieldViewProps {
  column: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}

// Passive: one attribute field — ISO label + text input, reused per attribute.
export function AttributeFieldView({ column, label, value, error, onChange }: AttributeFieldViewProps) {
  return (
    <TextField
      id={`attr-${column}`}
      label={label}
      value={value}
      error={error}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
