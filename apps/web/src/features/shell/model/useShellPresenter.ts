import { useCallback, useState } from 'react';
import { usePersona } from '../../../entities/persona/usePersona';

// Persona is UX routing only. The drawer reveals tools per role; the backend
// enforces authorization on every write regardless of what is shown.
export function useShellPresenter(): {
  hasDrawer: boolean;
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
} {
  const { available } = usePersona();

  // Only the steward persona has real tools today. Governance/Research have
  // none yet (design §5), so viewers get no drawer at all.
  const hasDrawer = available.includes('steward');

  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { hasDrawer, isOpen, toggle, close };
}
