import { useState, useCallback } from 'react';

export type RailItemId = 'layers' | 'legend' | 'assistant' | 'edit';

/** Which rail panel is open. Toggling the active item closes it, giving a full-bleed map. */
export function useRail(initial: RailItemId | null = 'layers') {
  const [active, setActive] = useState<RailItemId | null>(initial);
  const toggle = useCallback((id: RailItemId) => {
    setActive((current) => (current === id ? null : id));
  }, []);
  return { active, toggle };
}
