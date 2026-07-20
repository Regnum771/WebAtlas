import { useCallback, useMemo, useState } from 'react';
import { useSession } from '../session/model/session.store';
import { rolePersonas, type PersonaId } from './persona';

export const PERSONA_STORAGE_KEY = 'webatlas.persona';

function readStoredPick(): PersonaId | null {
  try {
    const raw = localStorage.getItem(PERSONA_STORAGE_KEY);
    return (raw as PersonaId | null) ?? null;
  } catch {
    return null;
  }
}

export function usePersona(): { available: PersonaId[]; active: PersonaId; setActive: (id: PersonaId) => void } {
  const { currentUser } = useSession();
  const available = useMemo(() => rolePersonas(currentUser?.role), [currentUser?.role]);

  // Version counter to re-derive active after a setActive write.
  const [tick, setTick] = useState(0);

  const active = useMemo(() => {
    const stored = readStoredPick();
    if (stored && available.includes(stored)) return stored;
    return available[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, tick]);

  const setActive = useCallback((id: PersonaId) => {
    if (!available.includes(id)) return; // reject out-of-role picks
    try { localStorage.setItem(PERSONA_STORAGE_KEY, id); } catch { /* ignore */ }
    setTick((t) => t + 1);
  }, [available]);

  return { available, active, setActive };
}
