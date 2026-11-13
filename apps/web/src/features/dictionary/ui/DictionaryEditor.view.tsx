import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { TextField } from '../../../shared/ui/TextField';
import { StoredUnitDialogView, type StoredUnitView } from './StoredUnitDialog.view';
import { ValueListEditorView, type ValueListView } from './ValueListEditor.view';
import { ui } from '../../../shared/ui/styles';

export interface FormFieldView {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checks' | 'locked';
  /** The text value; for `checks`, see `selected`. */
  value: string;
  selected?: string[];
  options?: { value: string; label: string }[];
  error?: string;
  hint?: string;
  /** "Đã sửa bởi <tên> lúc <thời gian>" when staff changed the field. */
  edited?: string;
  /** A date field that can be emptied (un-retire). */
  clearable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** A button beside a locked field, e.g. the stored-unit correction. */
  action?: { label: string; onClick: () => void };
}

export interface EditorFormView {
  /** Prefix of the element ids, so two forms on one page do not clash. */
  idPrefix: string;
  title: string;
  fields: FormFieldView[];
  dirty: boolean;
  saving: boolean;
  message: string | null;
  canRestoreAll: boolean;
  onChange: (key: string, value: string | string[]) => void;
  onSave: () => void;
  onRestore: (key: string) => void;
  onRestoreAll: () => void;
}

export interface EditorProps {
  layers: { key: string; name: string }[];
  layerKey: string;
  onLayer: (key: string) => void;
  /** The attribute list of the chosen layer. */
  attributes: { name: string; label: string; retired: boolean }[];
  /** Null means the feature-type form. */
  attributeName: string | null;
  onAttribute: (name: string | null) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** The feature-type form, above the attribute list. */
  layerForm: EditorFormView | null;
  /** The form of the chosen attribute. */
  attributeForm: EditorFormView | null;
  /** The listed values of the chosen code attribute. */
  valueList: ValueListView | null;
  /** The stored-unit correction dialog of the chosen number attribute. */
  storedUnit: StoredUnitView | null;
}

function Field({ field, form }: { field: FormFieldView; form: EditorFormView }) {
  const id = `${form.idPrefix}-${field.key}`;
  const edited = field.edited && (
    <p className={`${ui.note} flex flex-wrap items-center gap-1.5`}>
      {field.edited}{' '}
      <Button size="sm" variant="quiet" onClick={() => form.onRestore(field.key)}>Khôi phục mặc định</Button>
    </p>
  );

  if (field.kind === 'locked') {
    return (
      <div data-slot="dictionary-field" className="flex flex-col items-start gap-1.5 [&>*:first-child]:self-stretch">
        <TextField id={id} label={field.label} value={field.value} readOnly hint={field.hint} />
        {field.action && <Button size="sm" onClick={field.action.onClick}>{field.action.label}</Button>}
      </div>
    );
  }
  if (field.kind === 'checks') {
    return (
      <fieldset data-slot="dictionary-field" className={ui.fieldset} aria-describedby={field.error ? `${id}-error` : undefined}>
        <legend className={ui.legend}>{field.label}</legend>
        {field.options?.map((o) => {
          const on = field.selected?.includes(o.value) ?? false;
          return (
            <label key={o.value} className={ui.check}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => form.onChange(field.key, on
                  ? (field.selected ?? []).filter((v) => v !== o.value)
                  : [...(field.selected ?? []), o.value])}
              />
              <span>{o.label}</span>
            </label>
          );
        })}
        {field.error && <p id={`${id}-error`} className={ui.fieldError} role="alert">{field.error}</p>}
        {edited}
      </fieldset>
    );
  }
  if (field.kind === 'select' || field.kind === 'textarea') {
    return (
      <div data-slot="dictionary-field" className={ui.field}>
        <label htmlFor={id} className={ui.label}>{field.label}</label>
        {field.kind === 'select' ? (
          <select
            id={id} className={ui.select} value={field.value} aria-invalid={field.error ? true : undefined}
            onChange={(e) => form.onChange(field.key, e.target.value)}
          >
            {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <textarea
            id={id} className={ui.textarea} rows={4} value={field.value} aria-invalid={field.error ? true : undefined}
            onChange={(e) => form.onChange(field.key, e.target.value)}
          />
        )}
        {field.error && <p className={ui.fieldError} role="alert">{field.error}</p>}
        {edited}
      </div>
    );
  }
  return (
    <div data-slot="dictionary-field" className="flex flex-col items-start gap-1.5 [&>*:first-child]:self-stretch">
      <TextField
        id={id} label={field.label} type={field.kind} value={field.value} error={field.error} hint={field.hint}
        min={field.min} max={field.max} step={field.step}
        onChange={(e) => form.onChange(field.key, e.target.value)}
      />
      {field.clearable && field.value !== '' && (
        <Button size="sm" variant="quiet" onClick={() => form.onChange(field.key, '')}>Bỏ ngừng dùng</Button>
      )}
      {edited}
    </div>
  );
}

function EditorForm({ form }: { form: EditorFormView }) {
  return (
    <form
      className={`${ui.panel} min-w-0`}
      aria-label={form.title}
      onSubmit={(e) => { e.preventDefault(); form.onSave(); }}
    >
      <h3 className="text-panel font-semibold">{form.title}</h3>
      {form.message && <Message tone="error" title={form.message} />}
      {form.fields.map((f) => <Field key={f.key} field={f} form={form} />)}
      <div className={ui.acts}>
        <Button type="submit" variant="solid" busy={form.saving} busyLabel="Đang lưu…">Lưu</Button>
        {form.canRestoreAll && <Button onClick={form.onRestoreAll}>Khôi phục tất cả</Button>}
      </div>
    </form>
  );
}

/** Passive: layer picker, the feature-type form, the attribute list and the chosen attribute's form. */
export function DictionaryEditorView(p: EditorProps) {
  return (
    <div data-slot="dictionary-editor" className="flex flex-col gap-4 text-body text-ink">
      <div className={`${ui.field} max-w-sm`}>
        <label htmlFor="dict-layer" className={ui.label}>Lớp</label>
        <select id="dict-layer" className={ui.select} value={p.layerKey} onChange={(e) => p.onLayer(e.target.value)}>
          {p.layers.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
        </select>
      </div>
      {p.error && (
        <Message tone="error" title={p.error} actions={<Button onClick={p.onRetry}>Thử lại</Button>} />
      )}
      {p.loading && <Spinner label="Đang tải…" />}
      {!p.loading && !p.error && (
        <>
          {p.layerForm && <EditorForm form={p.layerForm} />}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <nav aria-label="Thuộc tính" className="shrink-0 rounded-lg border border-line bg-surface p-1 lg:w-56">
              <ul className="m-0 flex max-h-[420px] list-none flex-col overflow-y-auto p-0">
                {p.attributes.map((a) => (
                  <li key={a.name}>
                    <button type="button" aria-current={p.attributeName === a.name ? 'true' : undefined}
                      className="flex min-h-control-sm w-full cursor-pointer items-center rounded-md px-2 text-left text-ink hover:bg-surface-2 aria-[current=true]:bg-brand-tint aria-[current=true]:font-semibold aria-[current=true]:text-brand"
                      onClick={() => p.onAttribute(a.name)}>
                      {a.label}{a.retired ? ' (đã ngừng dùng)' : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {p.attributeForm && <EditorForm form={p.attributeForm} />}
              {p.valueList && <ValueListEditorView list={p.valueList} />}
            </div>
          </div>
        </>
      )}
      {p.storedUnit && <StoredUnitDialogView {...p.storedUnit} />}
    </div>
  );
}
