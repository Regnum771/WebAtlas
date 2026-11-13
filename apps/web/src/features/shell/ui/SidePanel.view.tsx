import type { ReactNode } from 'react';

/**
 * The contents panel (spec "Contents panel"): a 312 px card floating 8 px right of the rail at the
 * map stage's top-left, ending 8 px above the status bar. The body scrolls; the footer stays pinned.
 * Folded (`collapsed`), it stays mounted but hidden, so its sections keep their state.
 *
 * It carries no data-slot: Bản của tôi and the catalogue section inside are still legacy content,
 * and must keep the browser defaults the legacy-compat sheet gives them. For the same reason it
 * sets border-solid itself (the compat sheet reverts preflight's border style on it), and the
 * footer zeroes its other three sides (the revert also brings back the browser's medium width).
 */
export function SidePanelView({ children, footer, collapsed = false }: { children: ReactNode; footer: ReactNode; collapsed?: boolean }) {
  return (
    <aside
      aria-label="Bảng bản đồ"
      hidden={collapsed}
      className="side-panel absolute top-2 bottom-10 left-[calc(var(--contents-rail)+16px)] z-[15] [&[hidden]]:hidden flex w-[var(--panel-width)] flex-col overflow-hidden rounded-lg border border-solid border-line bg-surface text-ink"
    >
      <div className="side-panel-body min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="side-panel-footer flex-none border-0 border-t border-solid border-line-2 px-3 py-2 text-body">{footer}</div>
    </aside>
  );
}
