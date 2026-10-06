import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** The assistant column, docked at the right of the map. */
export function AssistantDockView({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <aside className="assistant-dock" aria-label="Trợ lý">
      <button type="button" className="assistant-dock-close" aria-label="Đóng trợ lý" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
      {children}
    </aside>
  );
}
