import type { ReactNode } from 'react';

/** The docked left panel: the body scrolls, the footer stays pinned at the bottom. */
export function SidePanelView({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <aside className="side-panel" aria-label="Bảng bản đồ">
      <div className="side-panel-body">{children}</div>
      <div className="side-panel-footer">{footer}</div>
    </aside>
  );
}
