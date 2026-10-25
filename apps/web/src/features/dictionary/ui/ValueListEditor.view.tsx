import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';

const STRUCTURE_HINT = 'theo cấu trúc dữ liệu';

export interface ValueRowView {
  code: string;
  name: string;
  definition: string;
  /** '#RRGGBB' or '' when none. */
  colorHint: string;
  retired: boolean;
  dirty: boolean;
  saving: boolean;
  message: string | null;
  /** Messages by field: name, definition, colorHint. */
  errors: Record<string, string>;
  onChange: (field: 'name' | 'definition' | 'colorHint', value: string) => void;
  onSave: () => void;
  /** Null on a closed list: retiring a code follows the data structure. */
  onToggleRetired: (() => void) | null;
}

export interface ValueAddView {
  code: string;
  name: string;
  definition: string;
  canAdd: boolean;
  saving: boolean;
  message: string | null;
  /** Messages by field: code, name, definition. */
  errors: Record<string, string>;
  onChange: (field: 'code' | 'name' | 'definition', value: string) => void;
  onSubmit: () => void;
}

export interface ValueListView {
  attributeLabel: string;
  rows: ValueRowView[];
  /** Null on a closed list. */
  add: ValueAddView | null;
}

function ValueRow({ row }: { row: ValueRowView }) {
  const c = row.code;
  const bad = (field: string) => (row.errors[field] ? true : undefined);
  return (
    <li className="dictionary-value-row">
      <div className="dictionary-value-code">
        <code>{c}</code>
        {row.retired && <span className="hint">(đã ngừng dùng)</span>}
        <span className="hint">{STRUCTURE_HINT}</span>
      </div>
      {row.message && <Message tone="error" title={row.message} />}
      <input
        className="input" aria-label={`Tên giá trị ${c}`} value={row.name} aria-invalid={bad('name')}
        onChange={(e) => row.onChange('name', e.target.value)}
      />
      {row.errors.name && <p className="hint bad" role="alert">{row.errors.name}</p>}
      <textarea
        className="input" rows={2} aria-label={`Định nghĩa giá trị ${c}`} value={row.definition} aria-invalid={bad('definition')}
        onChange={(e) => row.onChange('definition', e.target.value)}
      />
      {row.errors.definition && <p className="hint bad" role="alert">{row.errors.definition}</p>}
      <input
        className="input dictionary-value-color" aria-label={`Màu gợi ý giá trị ${c}`} placeholder="#RRGGBB"
        value={row.colorHint} aria-invalid={bad('colorHint')}
        onChange={(e) => row.onChange('colorHint', e.target.value)}
      />
      {row.errors.colorHint && <p className="hint bad" role="alert">{row.errors.colorHint}</p>}
      <div className="acts">
        <Button
          size="sm" variant="solid" busy={row.saving} busyLabel="Đang lưu…" disabled={!row.dirty}
          aria-label={`Lưu giá trị ${c}`} onClick={row.onSave}
        >
          Lưu
        </Button>
        {row.onToggleRetired ? (
          <Button size="sm" aria-label={`${row.retired ? 'Dùng lại' : 'Ngừng dùng'} giá trị ${c}`} onClick={row.onToggleRetired}>
            {row.retired ? 'Dùng lại' : 'Ngừng dùng'}
          </Button>
        ) : (
          <span className="hint">{STRUCTURE_HINT}</span>
        )}
      </div>
    </li>
  );
}

function AddForm({ add }: { add: ValueAddView }) {
  const field = (key: 'code' | 'name' | 'definition', label: string) => {
    const id = `dict-value-add-${key}`;
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id} className="input" value={add[key]} aria-invalid={add.errors[key] ? true : undefined}
          onChange={(e) => add.onChange(key, e.target.value)}
        />
        {add.errors[key] && <p className="hint bad" role="alert">{add.errors[key]}</p>}
      </div>
    );
  };
  return (
    <form
      className="dictionary-editor-form dictionary-value-add" aria-label="Thêm giá trị"
      onSubmit={(e) => { e.preventDefault(); if (add.canAdd) add.onSubmit(); }}
    >
      {add.message && <Message tone="error" title={add.message} />}
      {field('code', 'Mã')}
      {field('name', 'Tên giá trị')}
      {field('definition', 'Định nghĩa')}
      <div className="acts">
        <Button type="submit" variant="solid" disabled={!add.canAdd} busy={add.saving} busyLabel="Đang thêm…">Thêm giá trị</Button>
      </div>
    </form>
  );
}

/** Passive: the listed values of a code attribute, with their controls. */
export function ValueListEditorView({ list }: { list: ValueListView }) {
  return (
    <section className="dictionary-values" aria-label={`Giá trị của ${list.attributeLabel}`}>
      <h3>Giá trị</h3>
      {list.add === null && <p className="hint">Danh sách này {STRUCTURE_HINT}: không thêm mã mới được.</p>}
      <ul className="dictionary-value-list">
        {list.rows.map((r) => <ValueRow key={r.code} row={r} />)}
      </ul>
      {list.add && <AddForm add={list.add} />}
    </section>
  );
}
