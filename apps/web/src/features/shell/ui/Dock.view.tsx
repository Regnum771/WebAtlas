import type { KeyboardEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';
import { cn } from '@/shared/lib/utils';

export interface DockViewProps {
  /** `column`: the page's third column (1100 px and wider). `drawer`: over the map's right edge. */
  variant: 'column' | 'drawer';
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The dock on the map's right (spec "Map with the forecast and analysis dock"): 500 px wide and
 * full height. From 1100 px it is a page column, so it never covers the map's status bar.
 *
 * Below 1100 px it is a drawer over the map's right edge, mounted inside the map stage: it stops
 * above the status bar and the time row (R8), slides in (not under reduced motion), and closes
 * from its × or Escape pressed inside it. It is not a dialog: the map beside it stays in use and in
 * the accessibility tree. (Vaul was tried: its 1.1.2 never passes `modal` to the Radix dialog it
 * wraps, so its drawer trapped focus and hid the map. K4 plan, decision 12.) Its z-index (95) is
 * above the routed pages (90), so Trợ lý also works on /print and /quan-ly.
 *
 * The body holds legacy content (Trợ lý) and carries no data-slot, so it sets border-solid itself.
 */
export function DockView({ variant, title, closeLabel, onClose, children }: DockViewProps) {
  const drawer = variant === 'drawer';
  const onKeyDown = (e: KeyboardEvent) => {
    if (drawer && e.key === 'Escape' && !e.defaultPrevented) onClose();
  };
  return (
    <aside
      aria-label={title}
      data-variant={variant}
      onKeyDown={onKeyDown}
      className={cn(
        'dock flex min-h-0 flex-col border-solid border-line bg-surface text-ink',
        drawer
          ? 'absolute top-0 right-0 bottom-[calc(32px+var(--time-row-height,0px))] z-[95] w-[min(var(--dock-width),calc(100%-58px))] overflow-hidden rounded-l-lg border border-r-0 shadow-pop animate-[dock-in_var(--motion-base)_ease-out] motion-reduce:animate-none'
          : 'border-0 border-l',
      )}
    >
      <div className="flex h-[40px] flex-none items-center justify-between gap-2 border-0 border-b border-solid border-line-2 bg-surface-2 pr-1.5 pl-3">
        <h2 className="m-0 text-panel font-semibold text-ink">{title}</h2>
        <IconButton label={closeLabel} side="bottom" onClick={onClose} className="size-control-sm border-transparent bg-transparent">
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
