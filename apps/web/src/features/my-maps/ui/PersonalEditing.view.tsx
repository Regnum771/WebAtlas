import type { ReactNode } from 'react';
import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { Message } from '../../../shared/ui/Message';
import type { PersonalEditStep } from '../model/usePersonalEditingPresenter';

interface Props {
  step: PersonalEditStep | null;
  /** `điểm`, `đường` or `vùng`, while drawing. */
  drawShape: string | null;
  /** A recipient: the form only, no buttons. */
  readOnly: boolean;
  /** The open feature is a new drawing (nothing stored to delete). */
  isNew: boolean;
  reshaping: boolean;
  confirmOpen: boolean;
  deleting: boolean;
  /** A failed delete. */
  error: string | null;
  onLeave: () => void;
  onReshape: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** The open feature's form (free layer or edit copy), shown in the form step. */
  children?: ReactNode;
}

/**
 * Passive: the pane beside the table's rows — Vẽ thêm's drawing hint, or the selected feature's
 * form with Sửa hình and Xoá đối tượng (read-only for a recipient). Nothing while neither is open.
 */
export function PersonalEditingView(p: Props) {
  if (!p.step) return null;
  return (
    <div className="layer-table-form">
      {p.step === 'drawing' && (
        <>
          <p className="edit-hint">{`Vẽ ${p.drawShape ?? ''} lên bản đồ để tiếp tục.`}</p>
          <div className="my-map-actions">
            <Button size="sm" onClick={p.onLeave}>Huỷ</Button>
          </div>
        </>
      )}
      {p.step === 'form' && (
        <>
          {p.children}
          {!p.readOnly && (
            <>
              {p.reshaping && <p className="edit-hint">Kéo hình hoặc các đỉnh trên bản đồ để sửa.</p>}
              <div className="my-map-actions">
                <Button size="sm" aria-pressed={p.reshaping} disabled={p.reshaping} onClick={p.onReshape}>Sửa hình</Button>
                {!p.isNew && <Button size="sm" variant="danger" onClick={p.onAskDelete}>Xoá đối tượng</Button>}
              </div>
              {p.error && <Message tone="error" title={p.error} />}
            </>
          )}
        </>
      )}
      {!p.readOnly && (
        <ConfirmDialog
          open={p.confirmOpen}
          title="Xoá đối tượng này?"
          message="Không khôi phục được."
          confirmLabel="Xoá"
          irreversible
          busy={p.deleting}
          onConfirm={p.onConfirmDelete}
          onCancel={p.onCancelDelete}
        />
      )}
    </div>
  );
}
