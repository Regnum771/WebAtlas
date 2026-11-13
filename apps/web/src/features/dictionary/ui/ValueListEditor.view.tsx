import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { ui } from '../../../shared/ui/styles';

const STRUCTURE_HINT = 'theo cấu trúc dữ liệu';

export interface ValueRowView {
  code: string;
  name: string;
  definition: string;
  /** '#RRGGBB' or '' when none. */
  colorHint: string;
  retired: boolean;
  dirty: boolean;
  /** Another save is in flight: its reload brings the new revision, so no row may save before it. */
  locked: boolean;
  saving: boolean;
  message: string | null;
  /** Messages by field: name, definition, colorHint. */
  errors: Record<string, string>;
  onChange: (field: 'name' | 'definition' | 'colorHint', value: string) => void;
  onSave: () => void;
  /** Null on a closed list: retiring a code follows the data structure. */
  onToggleRetired: (() => void) | null;
  /** Puts name, definition and colour back to the code default; null for a code the default does not list. */
  onRestore: (() => void) | null;
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
    <li className="flex flex-col gap-2 border-t border-line-3 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="rounded-sm border border-line bg-surface-2 px-1 font-num text-num">{c}</code>
        {row.retired && <span className={ui.note}>(đã ngừng dùng)</span>}
        <span className={ui.note}>{STRUCTURE_HINT}</span>
      </div>
      {row.message && <Message tone="error" title={row.message} />}
      <input
        className={ui.input} aria-label={`Tên giá trị ${c}`} value={row.name} aria-invalid={bad('name')}
        onChange={(e) => row.onChange('name', e.target.value)}
      />
      {row.errors.name && <p className={ui.fieldError} role="alert">{row.errors.name}</p>}
      <textarea
        className={ui.textarea} rows={2} aria-label={`Định nghĩa giá trị ${c}`} value={row.definition} aria-invalid={bad('definition')}
        onChange={(e) => row.onChange('definition', e.target.value)}
      />
      {row.errors.definition && <p className={ui.fieldError} role="alert">{row.errors.definition}</p>}
      <input
        className={`${ui.input} max-w-40 font-num`} aria-label={`Màu gợi ý giá trị ${c}`} placeholder="#RRGGBB"
        value={row.colorHint} aria-invalid={bad('colorHint')}
        onChange={(e) => row.onChange('colorHint', e.target.value)}
      />
      {row.errors.colorHint && <p className={ui.fieldError} role="alert">{row.errors.colorHint}</p>}
      <div className={ui.acts}>
        <Button
          size="sm" variant="solid" busy={row.saving} busyLabel="Đang lưu…" disabled={!row.dirty || row.locked}
          aria-label={`Lưu giá trị ${c}`} onClick={row.onSave}
        >
          Lưu
        </Button>
        {row.onToggleRetired ? (
          <Button size="sm" disabled={row.locked} aria-label={`${row.retired ? 'Dùng lại' : 'Ngừng dùng'} giá trị ${c}`} onClick={row.onToggleRetired}>
            {row.retired ? 'Dùng lại' : 'Ngừng dùng'}
          </Button>
        ) : (
          <span className={ui.note}>{STRUCTURE_HINT}</span>
        )}
        {row.onRestore && (
          <Button size="sm" variant="quiet" disabled={row.locked} aria-label={`Khôi phục mặc định giá trị ${c}`} onClick={row.onRestore}>
            Khôi phục mặc định
          </Button>
        )}
      </div>
    </li>
  );
}

function AddForm({ add }: { add: ValueAddView }) {
  const field = (key: 'code' | 'name' | 'definition', label: string) => {
    const id = `dict-value-add-${key}`;
    return (
      <div className={ui.field}>
        <label htmlFor={id} className={ui.label}>{label}</label>
        <input
          id={id} className={ui.input} value={add[key]} aria-invalid={add.errors[key] ? true : undefined}
          onChange={(e) => add.onChange(key, e.target.value)}
        />
        {add.errors[key] && <p className={ui.fieldError} role="alert">{add.errors[key]}</p>}
      </div>
    );
  };
  return (
    <form
      className="flex flex-col gap-3 border-t border-line-2 pt-3" aria-label="Thêm giá trị"
      onSubmit={(e) => { e.preventDefault(); if (add.canAdd) add.onSubmit(); }}
    >
      {add.message && <Message tone="error" title={add.message} />}
      {field('code', 'Mã')}
      {field('name', 'Tên giá trị')}
      {field('definition', 'Định nghĩa')}
      <div className={ui.acts}>
        <Button type="submit" variant="solid" disabled={!add.canAdd} busy={add.saving} busyLabel="Đang thêm…">Thêm giá trị</Button>
      </div>
    </form>
  );
}

/** Passive: the listed values of a code attribute, with their controls. */
export function ValueListEditorView({ list }: { list: ValueListView }) {
  return (
    <section className={ui.panel} aria-label={`Giá trị của ${list.attributeLabel}`}>
      <h3 className="text-panel font-semibold">Giá trị</h3>
      {list.add === null && <p className={ui.note}>Danh sách này {STRUCTURE_HINT}: không thêm mã mới được.</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {list.rows.map((r) => <ValueRow key={r.code} row={r} />)}
      </ul>
      {list.add && <AddForm add={list.add} />}
    </section>
  );
}
