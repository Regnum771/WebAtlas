import { X } from 'lucide-react';
import type { FilterField } from '@webatlas/shared';
import type { Condition, Operator } from '../model/applyFilter';

export function ConditionRowView({ condition, fields, onChange, onRemove }: {
  condition: Condition;
  fields: FilterField[];
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
}) {
  const field = fields.find((f) => f.iso === condition.field) ?? fields[0];
  const isNumeric = field?.type === 'number' || field?.type === 'date';

  return (
    <div className="condition-row">
      <select
        className="condition-field"
        value={condition.field}
        onChange={(e) => onChange({ field: e.target.value })}
        aria-label="Thuộc tính"
      >
        {fields.map((f) => (
          <option key={f.iso} value={f.iso}>{f.label}</option>
        ))}
      </select>

      {isNumeric ? (
        <>
          <select
            className="condition-op"
            value={condition.op}
            onChange={(e) => onChange({ op: e.target.value as Operator })}
            aria-label="Toán tử"
          >
            <option value="gte">&ge;</option>
            <option value="lte">&le;</option>
            <option value="eq">=</option>
          </select>
          <input
            className="condition-value"
            type="number"
            value={condition.value === '' || condition.value == null ? '' : String(condition.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            aria-label="Giá trị"
          />
        </>
      ) : field?.type === 'enum' ? (
        <select
          className="condition-value"
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ op: 'eq', value: e.target.value })}
          aria-label="Giá trị"
        >
          <option value="">—</option>
          {field.enumValues!.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          className="condition-value"
          type="text"
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ op: 'eq', value: e.target.value })}
          aria-label="Giá trị"
        />
      )}

      <button type="button" className="condition-remove" onClick={onRemove} aria-label="Xóa điều kiện">
        <X size={14} />
      </button>
    </div>
  );
}
