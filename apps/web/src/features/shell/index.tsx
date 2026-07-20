import { Menu } from 'lucide-react';
import { useShellPresenter } from './model/useShellPresenter';
import { EditDrawerView } from './ui/EditDrawer.view';
import FeatureEditing from '../feature-editing';

// The drawer reveals editing tools per role. This is UX only — FeatureEditing
// keeps its own RequireRole gate and the backend enforces every write.
export default function Shell() {
  const s = useShellPresenter();
  if (!s.hasDrawer) return null;
  return (
    <>
      <button
        type="button"
        className="burger-btn glass-panel"
        onClick={s.toggle}
        aria-label="Menu"
        aria-expanded={s.isOpen}
      >
        <Menu size={18} />
      </button>
      <EditDrawerView open={s.isOpen} onClose={s.close}>
        <FeatureEditing />
      </EditDrawerView>
    </>
  );
}
