import type { ReactNode } from 'react';
import { Button } from '../../../shared/ui/Button';
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog';
import { Message } from '../../../shared/ui/Message';
import type { PersonalEditKind, PersonalEditStep } from '../model/usePersonalEditingPresenter';

interface Props {
  /** This map holds the section's drawing or feature-edit mode. */
  active: boolean;
  kind: PersonalEditKind | null;
  step: PersonalEditStep | null;
  /** The layers Vẽ thêm can draw into. */
  layers: { id: string; title: string }[];
  /** `điểm`, `đường` or `vùng`, while drawing. */
  drawShape: string | null;
  /** The open feature is a new drawing (nothing stored to delete). */
  isNew: boolean;
  reshaping: boolean;
  confirmOpen: boolean;
  deleting: boolean;
  /** A failed delete. */
  error: string | null;
  onDraw: () => void;
  onEdit: () => void;
  onPick: (layerId: string) => void;
  onLeave: () => void;
  onReshape: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** The open feature's form (free layer or edit copy), shown in the form step. */
  children?: ReactNode;
}

/** Passive: the owner's Vẽ thêm and Sửa đối tượng controls on an expanded map, and the mode they open. */
export function PersonalEditingView(p: Props) {
  if (!p.active) {
    return (
      <div className="my-map-actions">
        <Button size="sm" onClick={p.onDraw}>Vẽ thêm</Button>
        <Button size="sm" onClick={p.onEdit}>Sửa đối tượng</Button>
      </div>
    );
  }
  return (
    <div className="my-map-editing">
      {p.step === 'pick' && (
        <>
          {p.layers.length === 0
            ? <p className="edit-hint">Chưa có lớp nào để vẽ.</p>
            : <p className="edit-hint">Chọn lớp để vẽ.</p>}
          <div className="my-map-actions">
            {p.layers.map((layer) => (
              <Button key={layer.id} size="sm" onClick={() => p.onPick(layer.id)}>{layer.title}</Button>
            ))}
            <Button size="sm" onClick={p.onLeave}>Huỷ</Button>
          </div>
        </>
      )}
      {p.step === 'drawing' && (
        <>
          <p className="edit-hint">{`Vẽ ${p.drawShape ?? ''} lên bản đồ để tiếp tục.`}</p>
          <div className="my-map-actions">
            <Button size="sm" onClick={p.onLeave}>Huỷ</Button>
          </div>
        </>
      )}
      {p.kind === 'edit' && (p.step === 'select' || p.step === 'form') && (
        <p className="edit-hint">Bấm một đối tượng của bản đồ này để sửa.</p>
      )}
      {p.step === 'select' && (
        <div className="my-map-actions">
          <Button size="sm" onClick={p.onLeave}>Thoát sửa</Button>
        </div>
      )}
      {p.step === 'form' && (
        <>
          {p.children}
          {p.reshaping && <p className="edit-hint">Kéo hình hoặc các đỉnh trên bản đồ để sửa.</p>}
          <div className="my-map-actions">
            <Button size="sm" aria-pressed={p.reshaping} disabled={p.reshaping} onClick={p.onReshape}>Sửa hình</Button>
            {!p.isNew && <Button size="sm" variant="danger" onClick={p.onAskDelete}>Xoá đối tượng</Button>}
          </div>
          {p.error && <Message tone="error" title={p.error} />}
        </>
      )}
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
    </div>
  );
}
