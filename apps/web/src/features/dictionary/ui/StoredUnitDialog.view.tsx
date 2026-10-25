import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { TextField } from '../../../shared/ui/TextField';

export interface StoredUnitView {
  open: boolean;
  attributeLabel: string;
  /** Symbol of the unit stored now. */
  currentSymbol: string;
  /** The chosen new unit; the options are the units of the same dimension. */
  unit: string;
  units: { value: string; label: string }[];
  onUnit: (code: string) => void;
  canPreview: boolean;
  previewing: boolean;
  onPreview: () => void;
  /** Null until the chosen unit is previewed; an empty list means there is nothing to show. */
  preview: { id: string; stored: string; before: string; after: string }[] | null;
  date: string;
  /** The latest date offered, YYYY-MM-DD: today, or the attribute's retire date when earlier. */
  maxDate: string;
  onDate: (value: string) => void;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  canApply: boolean;
  applying: boolean;
  message: string | null;
  /** Messages by field: storedUnit, storedUnitValidFrom. */
  errors: Record<string, string>;
  onApply: () => void;
  onClose: () => void;
}

/** Passive: the stored-unit correction dialog (preview, date, confirmation). */
export function StoredUnitDialogView(p: StoredUnitView) {
  return (
    <Dialog open={p.open} title="Hiệu chỉnh đơn vị lưu" onClose={p.onClose}>
      <form className="dictionary-editor-form" onSubmit={(e) => { e.preventDefault(); if (p.canApply) p.onApply(); }}>
        <p className="hint">{p.attributeLabel} · đơn vị lưu hiện tại: {p.currentSymbol}</p>
        {p.message && <Message tone="error" title={p.message} />}
        <div className="field">
          <label htmlFor="dict-unit-new">Đơn vị lưu mới</label>
          <select
            id="dict-unit-new" className="input" value={p.unit} aria-invalid={p.errors.storedUnit ? true : undefined}
            onChange={(e) => p.onUnit(e.target.value)}
          >
            {p.units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          {p.errors.storedUnit && <p className="hint bad" role="alert">{p.errors.storedUnit}</p>}
        </div>
        <div className="acts">
          <Button disabled={!p.canPreview} busy={p.previewing} busyLabel="Đang tải…" onClick={p.onPreview}>Xem trước</Button>
        </div>
        {p.preview !== null && (p.preview.length === 0 ? (
          <p className="hint">Không có giá trị mẫu để xem trước.</p>
        ) : (
          <ul className="dictionary-unit-preview" aria-label="Kết quả xem trước">
            {p.preview.map((r) => (
              <li key={r.id}><span>{r.stored}</span>: {r.before} → {r.after}</li>
            ))}
          </ul>
        ))}
        <TextField
          id="dict-unit-date" label="Áp dụng từ ngày" type="date" value={p.date} max={p.maxDate} error={p.errors.storedUnitValidFrom}
          onChange={(e) => p.onDate(e.target.value)}
        />
        <label className="dictionary-check">
          <input type="checkbox" checked={p.confirmed} onChange={(e) => p.onConfirmed(e.target.checked)} />
          Tôi hiểu việc này chỉ sửa cách hiểu số liệu, không đổi số liệu.
        </label>
        <div className="acts">
          <Button type="submit" variant="solid" disabled={!p.canApply} busy={p.applying} busyLabel="Đang áp dụng…">Áp dụng</Button>
          <Button onClick={p.onClose}>Đóng</Button>
        </div>
      </form>
    </Dialog>
  );
}
