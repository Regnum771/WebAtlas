import type { PersonaId } from '../../../entities/persona/persona';
import type { Workspace } from '../model/useShellPresenter';

export function PersonaRailView({ workspaces, activeId, onSelect }: {
  workspaces: Workspace[];
  activeId: PersonaId;
  onSelect: (id: PersonaId) => void;
}) {
  if (workspaces.length === 0) return null;
  return (
    <nav className="persona-rail glass-panel" aria-label="Workspaces">
      {workspaces.map((w) => (
        <button
          key={w.id}
          type="button"
          className={`persona-rail-item ${w.id === activeId ? 'active' : ''}`}
          aria-current={w.id === activeId ? 'true' : undefined}
          onClick={() => onSelect(w.id)}
        >
          {w.label}
        </button>
      ))}
    </nav>
  );
}
