import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import { AttributeFieldView } from './AttributeField.view';

export interface ProposedEditWizardViewProps {
  title: string;
  columns: string[];
  labels: Record<string, string>;
  values: Record<string, string>;
  isChanged: (column: string) => boolean;
  previous: (column: string) => string;
  sourceDocument: string;
  sourceProvider: string;
  canSave: boolean;
  saving: boolean;
  error: string | null;
  /** A second line under the error, e.g. the missing review right of a refusal. */
  errorDetail?: string | null;
  onField: (column: string, value: string) => void;
  onSourceDocument: (value: string) => void;
  onSourceProvider: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Passive: every piece of state lives in useProposedEditPresenter.
export function ProposedEditWizardView(p: ProposedEditWizardViewProps) {
  return (
    <Dialog open title="Đề xuất cập nhật" onClose={p.onCancel}>
      <form
        className="proposal-wizard"
        onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}
      >
        <p className="proposal-subtitle">
          {p.title} — trợ lý đã điền sẵn giá trị đề xuất. Kiểm tra lại trước khi lưu.
        </p>

        {p.columns.map((c) => (
          <div key={c} className={`proposal-field${p.isChanged(c) ? ' changed' : ''}`}>
            <AttributeFieldView column={c} label={p.labels[c] ?? c} value={p.values[c] ?? ''} onChange={(v) => p.onField(c, v)} />
            {p.isChanged(c) && <span className="proposal-previous">Trước: {p.previous(c) || '(trống)'}</span>}
          </div>
        ))}

        <fieldset className="proposal-source">
          <legend>Nguồn số liệu</legend>
          <label htmlFor="proposal-source-document">Tài liệu nguồn *</label>
          <input
            id="proposal-source-document" type="text" required maxLength={500}
            placeholder="Ví dụ: Quyết định 123/QĐ-UBND"
            value={p.sourceDocument} onChange={(e) => p.onSourceDocument(e.target.value)}
          />
          <label htmlFor="proposal-source-provider">Người cung cấp *</label>
          <input
            id="proposal-source-provider" type="text" required maxLength={200}
            placeholder="Ví dụ: Sở Công Thương Đắk Lắk"
            value={p.sourceProvider} onChange={(e) => p.onSourceProvider(e.target.value)}
          />
        </fieldset>

        {p.error && <Message tone="error" title={p.error}>{p.errorDetail}</Message>}
        <div className="edit-form-actions">
          <Button type="submit" variant="solid" busy={p.saving} busyLabel="Đang lưu" disabled={!p.canSave && !p.saving}>Lưu</Button>
          <Button onClick={p.onCancel}>Huỷ</Button>
        </div>
      </form>
    </Dialog>
  );
}
