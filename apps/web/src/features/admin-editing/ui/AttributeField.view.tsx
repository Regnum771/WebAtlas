export interface AttributeFieldViewProps {
  column: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}

// Passive: one attribute field — ISO label + text input, reused per attribute.
export function AttributeFieldView({ column, label, value, error, onChange }: AttributeFieldViewProps) {
  const id = `attr-${column}`;
  return (
    <div className="edit-attr-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="edit-attr-error" role="alert">{error}</span>}
    </div>
  );
}
