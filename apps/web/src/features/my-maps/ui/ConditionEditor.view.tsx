import { useEffect, useRef } from 'react';
import type { ConditionPatch, ConditionView, TableColumnView } from '../model/useTablePresenter';

interface Props {
  condition: ConditionView;
  /** The columns a condition can test, by label. */
  fields: TableColumnView[];
  onChange: (patch: ConditionPatch) => void;
  /** Enter, Escape or focus leaving the editor closes it; the condition stays as edited. */
  onDone: () => void;
}

/**
 * One condition's editor under the toolbar: the field, the operators its type offers and, unless
 * the operator takes none, the value: typed, or picked by name for a code column. Each change
 * applies at once (a typed value waits for typing to pause before the table asks the server).
 */
export function ConditionEditorView({ condition, fields, onChange, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const value = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLSelectElement>(null);

  // Opening puts the cursor where the condition needs input.
  useEffect(() => {
    (value.current ?? field.current)?.focus();
  }, []);

  return (
    <div
      ref={root}
      className="layer-table-editor"
      role="group"
      aria-label="Điều kiện"
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          onDone();
        }
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) onDone();
      }}
    >
      <select
        ref={field}
        className="input layer-table-editor-field"
        aria-label="Trường"
        value={condition.field}
        onChange={(e) => onChange({ field: e.target.value })}
      >
        {fields.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
      </select>
      <select
        className="input layer-table-editor-op"
        aria-label="Phép so sánh"
        value={condition.op}
        onChange={(e) => onChange({ op: e.target.value })}
      >
        {condition.ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {condition.needsValue && condition.type === 'code' && (
        <select
          className="input layer-table-editor-value"
          aria-label="Giá trị"
          value={condition.value}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          {condition.value === '' && <option value="" disabled />}
          {(condition.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {condition.needsValue && condition.type !== 'code' && (
        <input
          ref={value}
          className="input layer-table-editor-value"
          aria-label="Giá trị"
          type={condition.type === 'date' ? 'date' : 'text'}
          inputMode={condition.type === 'number' ? 'decimal' : undefined}
          value={condition.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      )}
    </div>
  );
}
