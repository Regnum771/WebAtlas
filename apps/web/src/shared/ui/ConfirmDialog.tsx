import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Dumb confirm dialog over the shared Modal.
// display-panel/index.tsx is the only caller today (checked: no other screen depends
// on English defaults), so the Vietnamese copy lives here as the shared default rather
// than being passed down as props from each call site.
export function ConfirmDialog({ open, title, message, confirmLabel = 'Xác nhận', busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel}>
      <div className="confirm-dialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Đang xử lý…' : confirmLabel}</button>
          <button type="button" onClick={onCancel}>Hủy</button>
        </div>
      </div>
    </Modal>
  );
}
