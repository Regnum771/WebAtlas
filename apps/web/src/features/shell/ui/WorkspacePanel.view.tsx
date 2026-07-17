import type { ReactNode } from 'react';

export function WorkspacePanelView({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="workspace-panel glass-panel" aria-label={title}>
      <header className="workspace-panel-header">
        <h2>{title}</h2>
        <button type="button" className="workspace-panel-close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="workspace-panel-body">{children}</div>
    </aside>
  );
}
