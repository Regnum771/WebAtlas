import { useShellPresenter } from './model/useShellPresenter';
import { PERSONAS, type PersonaId } from '../../entities/persona/persona';
import { PersonaRailView } from './ui/PersonaRail.view';
import { WorkspacePanelView } from './ui/WorkspacePanel.view';
import { WorkspacePlaceholder } from './ui/WorkspacePlaceholder';
import FeatureEditing from '../feature-editing';
import UserManagement from '../user-management';

// Persona routing is UX only. Real authorization is enforced by the backend
// and by each hosted feature's own RequireRole gate; the shell only reveals
// which workspace's tools to show — it is never the access-control decision.
function WorkspaceContent({ activeId, onClose, open }: { activeId: PersonaId; onClose: () => void; open: boolean }) {
  if (activeId === 'steward') return <FeatureEditing />;
  if (activeId === 'admin') return <UserManagement open={open} onClose={onClose} />;
  if (activeId === 'governance' || activeId === 'research') return <WorkspacePlaceholder persona={activeId} />;
  return null;
}

export default function Shell() {
  const s = useShellPresenter();
  const hasWorkspace = s.workspaces.length > 0 && s.activeId !== 'public';
  return (
    <>
      <PersonaRailView workspaces={s.workspaces} activeId={s.activeId} onSelect={s.select} />
      <WorkspacePanelView open={s.isOpen && hasWorkspace} title={PERSONAS[s.activeId].label} onClose={s.close}>
        <WorkspaceContent activeId={s.activeId} onClose={s.close} open={s.isOpen && hasWorkspace} />
      </WorkspacePanelView>
    </>
  );
}
