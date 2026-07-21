import { useCallback, useState } from 'react';
import { usePersona } from '../../../entities/persona/usePersona';

// Persona is UX routing only. The drawer reveals tools per role; the backend
// enforces authorization on every write regardless of what is shown.
export function useShellPresenter(): {
  hasDrawer: boolean;
  canEdit: boolean;
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
} {
  const { available } = usePersona();

  // The drawer exists for EVERY role now: it hosts the filter, which is a display tool
  // available to all. Role gating moved inside — only the Edit section is steward-only.
  const hasDrawer = true;
  const canEdit = available.includes('steward');

  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { hasDrawer, canEdit, isOpen, toggle, close };
}
