import { Menu } from 'lucide-react';
import { useShellPresenter } from './model/useShellPresenter';
import { EditDrawerView } from './ui/EditDrawer.view';
import FeatureEditing from '../feature-editing';
import AttributeFilter from '../attribute-filter';

// The drawer is universal: the filter is a display tool for every role. Editing tools
// are revealed per persona — UX routing only; the backend enforces every write.
export default function Shell() {
  const s = useShellPresenter();
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
        <AttributeFilter />
        {s.canEdit && <FeatureEditing />}
      </EditDrawerView>
    </>
  );
}
