import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { Spinner } from '../../../shared/ui/Spinner';
import { TextField } from '../../../shared/ui/TextField';

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
}

export interface EditorFormView {
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
  form: EditorFormView | null;
}

function Field({ field, form }: { field: FormFieldView; form: EditorFormView }) {
  const id = `dict-${field.key}`;
  const edited = field.edited && (
    <p className="hint dictionary-edited">
      {field.edited}{' '}
      <Button size="sm" variant="quiet" onClick={() => form.onRestore(field.key)}>Khôi phục mặc định</Button>
    </p>
  );

  if (field.kind === 'locked') {
    return (
      <TextField id={id} label={field.label} value={field.value} readOnly hint={field.hint} />
    );
  }
  if (field.kind === 'checks') {
    return (
      <fieldset className="field dictionary-checks" aria-describedby={field.error ? `${id}-error` : undefined}>
        <legend>{field.label}</legend>
        {field.options?.map((o) => {
          const on = field.selected?.includes(o.value) ?? false;
          return (
            <label key={o.value} className="dictionary-check">
              <input
                type="checkbox"
                checked={on}
                onChange={() => form.onChange(field.key, on
                  ? (field.selected ?? []).filter((v) => v !== o.value)
                  : [...(field.selected ?? []), o.value])}
              />
              {o.label}
            </label>
          );
        })}
        {field.error && <p id={`${id}-error`} className="hint bad" role="alert">{field.error}</p>}
        {edited}
      </fieldset>
    );
  }
  if (field.kind === 'select' || field.kind === 'textarea') {
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        {field.kind === 'select' ? (
          <select
            id={id} className="input" value={field.value} aria-invalid={field.error ? true : undefined}
            onChange={(e) => form.onChange(field.key, e.target.value)}
          >
            {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <textarea
            id={id} className="input" rows={4} value={field.value} aria-invalid={field.error ? true : undefined}
            onChange={(e) => form.onChange(field.key, e.target.value)}
          />
        )}
        {field.error && <p className="hint bad" role="alert">{field.error}</p>}
        {edited}
      </div>
    );
  }
  return (
    <div className="dictionary-field">
      <TextField
        id={id} label={field.label} type={field.kind} value={field.value} error={field.error} hint={field.hint}
        onChange={(e) => form.onChange(field.key, e.target.value)}
      />
      {field.clearable && field.value !== '' && (
        <Button size="sm" variant="quiet" onClick={() => form.onChange(field.key, '')}>Bỏ ngừng dùng</Button>
      )}
      {edited}
    </div>
  );
}

/** Passive: layer picker, attribute list and the edit form of the chosen layer or attribute. */
export function DictionaryEditorView(p: EditorProps) {
  return (
    <div className="dictionary-editor">
      <div className="field">
        <label htmlFor="dict-layer">Lớp</label>
        <select id="dict-layer" className="input" value={p.layerKey} onChange={(e) => p.onLayer(e.target.value)}>
          {p.layers.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
        </select>
      </div>
      {p.error && (
        <Message tone="error" title={p.error} actions={<Button onClick={p.onRetry}>Thử lại</Button>} />
      )}
      {p.loading && <Spinner label="Đang tải…" />}
      {!p.loading && !p.error && (
        <div className="dictionary-editor-body">
          <nav aria-label="Thuộc tính" className="dictionary-editor-list">
            <ul>
              <li>
                <button type="button" className="link" aria-current={p.attributeName === null ? 'true' : undefined}
                  onClick={() => p.onAttribute(null)}>
                  Thông tin lớp
                </button>
              </li>
              {p.attributes.map((a) => (
                <li key={a.name}>
                  <button type="button" className="link" aria-current={p.attributeName === a.name ? 'true' : undefined}
                    onClick={() => p.onAttribute(a.name)}>
                    {a.label}{a.retired ? ' (đã ngừng dùng)' : ''}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {p.form && (
            <form
              className="dictionary-editor-form"
              aria-label={p.form.title}
              onSubmit={(e) => { e.preventDefault(); p.form?.onSave(); }}
            >
              <h3>{p.form.title}</h3>
              {p.form.message && <Message tone="error" title={p.form.message} />}
              {p.form.fields.map((f) => <Field key={f.key} field={f} form={p.form!} />)}
              <div className="acts">
                <Button type="submit" variant="solid" busy={p.form.saving} busyLabel="Đang lưu…"
                  aria-disabled={!p.form.dirty || undefined}>
                  Lưu
                </Button>
                {p.form.canRestoreAll && (
                  <Button onClick={p.form.onRestoreAll}>Khôi phục tất cả</Button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
