import type { ReactNode } from 'react';

/**
 * The contents panel (spec "Contents panel"): a 312 px card floating 8 px from the map stage's
 * top-left corner, ending 8 px above the status bar. The body scrolls; the footer stays pinned.
 *
 * It carries no data-slot: Bản của tôi and the catalogue section inside are still legacy content,
 * and must keep the browser defaults the legacy-compat sheet gives them. For the same reason it
 * sets border-solid itself (the compat sheet reverts preflight's border style on it), and the
 * footer zeroes its other three sides (the revert also brings back the browser's medium width).
 */
export function SidePanelView({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <aside
      aria-label="Bảng bản đồ"
      className="side-panel absolute top-2 bottom-10 left-2 z-[15] flex w-[var(--panel-width)] flex-col overflow-hidden rounded-lg border border-solid border-line bg-surface text-ink"
    >
      <div className="side-panel-body min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="side-panel-footer flex-none border-0 border-t border-solid border-line-2 px-3 py-2 text-body">{footer}</div>
    </aside>
  );
}
