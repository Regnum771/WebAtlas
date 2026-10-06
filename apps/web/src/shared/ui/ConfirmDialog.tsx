import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Repeats the verb of the title. */
  confirmLabel: string;
  /** True: the confirm button is red. */
  irreversible?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Dumb confirm dialog over the shared Dialog.
export function ConfirmDialog({ open, title, message, confirmLabel, irreversible = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <p className="dialog-message">{message}</p>
      <div className="dialog-actions">
        <Button onClick={onCancel}>Huỷ</Button>
        <Button variant={irreversible ? 'danger' : 'solid'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
