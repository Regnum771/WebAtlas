import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function EditDrawerView({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="edit-drawer glass-panel" aria-label="Công cụ">
      <header className="edit-drawer-header">
        <h2>Công cụ</h2>
        <button type="button" className="edit-drawer-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>
      <div className="edit-drawer-body">{children}</div>
    </aside>
  );
}
