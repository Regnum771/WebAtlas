import { useLayoutEffect, useRef } from 'react';

/**
 * Radix modals return focus to their Trigger on close, and our dialogs have none: any button
 * can open them. This remembers what had focus when `open` turned true and gives the
 * `onCloseAutoFocus` handler that puts focus back there.
 *
 * A layout effect runs before Radix's FocusScope moves focus inside (a passive effect),
 * so the element it records is still the opener.
 */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (event: Event) => {
    event.preventDefault();
    opener.current?.focus();
  };
}
