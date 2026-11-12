import { Button } from './Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './shadcn/alert-dialog';
import { useReturnFocus } from './useReturnFocus';

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

/**
 * Dumb confirm dialog on Radix AlertDialog: Huỷ has focus first, Escape cancels, and a press
 * outside does nothing, so a stray click never answers the question.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, irreversible = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.stopImmediatePropagation()} onCloseAutoFocus={returnFocus}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{message}</AlertDialogDescription>
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button>Huỷ</Button>
          </AlertDialogCancel>
          <Button variant={irreversible ? 'danger' : 'solid'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
