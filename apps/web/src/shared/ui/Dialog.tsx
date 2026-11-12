import type { ReactNode } from 'react';
import { Dialog as DialogRoot, DialogContent, DialogTitle } from './shadcn/dialog';
import { useReturnFocus } from './useReturnFocus';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The one modal, on Radix Dialog: portalled to document.body, focus trapped and returned to
 * the opener, only the topmost dialog of a stack reacts to Escape.
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogRoot open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        // Radix listens in the capture phase on document; stopping here keeps Escape from
        // reaching a menu or popup behind the dialog.
        onEscapeKeyDown={(event) => event.stopImmediatePropagation()}
        onCloseAutoFocus={returnFocus}
      >
        <DialogTitle>{title}</DialogTitle>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
