import { Plus, X } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import type { FieldDef } from '../api/workspace.api';

/** One editable field row; `from` is the declared name an existing field had (kept for a rename). */
export interface FieldRow extends FieldDef {
  from?: string;
}

const TYPES: { value: FieldDef['type']; label: string }[] = [
  { value: 'text', label: 'Chữ' },
  { value: 'number', label: 'Số' },
  { value: 'date', label: 'Ngày' },
];

interface Props {
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
}

/** The rows of `Trường thông tin`: a name, a type and a remove button each, and `Thêm trường`. */
export function FieldsEditorView({ rows, onChange }: Props) {
  const patch = (i: number, change: Partial<FieldRow>) =>
    onChange(rows.map((row, at) => (at === i ? { ...row, ...change } : row)));
  return (
    <div className="my-maps-fields">
      {rows.map((row, i) => (
        <div className="my-maps-field-row" key={i}>
          <input
            className="input"
            aria-label="Tên trường"
            value={row.name}
            maxLength={63}
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <select
            className="input"
            aria-label="Kiểu"
            value={row.type}
            onChange={(e) => patch(i, { type: e.target.value as FieldDef['type'] })}
          >
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <Button size="sm" variant="quiet" aria-label="Xoá trường" onClick={() => onChange(rows.filter((_, at) => at !== i))}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...rows, { name: '', type: 'text' }])}>
        <Plus size={14} aria-hidden="true" />
        Thêm trường
      </Button>
    </div>
  );
}
