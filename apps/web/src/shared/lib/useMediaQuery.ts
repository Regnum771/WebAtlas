import { useSyncExternalStore } from 'react';

/** Whether a media query matches, following changes. False where matchMedia is missing (jsdom). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
      mql?.addEventListener('change', onChange);
      return () => mql?.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' ? window.matchMedia?.(query).matches === true : false),
    () => false,
  );
}

/** The width from which the dock is a page column instead of a drawer over the map. */
export const DOCK_COLUMN_QUERY = '(min-width: 1100px)';
