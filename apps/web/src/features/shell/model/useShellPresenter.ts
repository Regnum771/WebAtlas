import { useMemo, useState } from 'react';
import { usePersona } from '../../../entities/persona/usePersona';
import { PERSONAS, type PersonaId } from '../../../entities/persona/persona';

export interface Workspace { id: PersonaId; label: string; }

export function useShellPresenter(): {
  workspaces: Workspace[];
  activeId: PersonaId;
  isOpen: boolean;
  select: (id: PersonaId) => void;
  close: () => void;
} {
  const { available, active, setActive } = usePersona();

  const workspaces = useMemo(
    () => available.filter((id) => id !== 'public').map((id) => ({ id, label: PERSONAS[id].label })),
    [available]
  );

  // Panel starts open when there is a non-public workspace to show.
  const [isOpen, setIsOpen] = useState(true);

  const select = (id: PersonaId) => { setActive(id); setIsOpen(true); };
  const close = () => setIsOpen(false);

  return { workspaces, activeId: active, isOpen, select, close };
}
