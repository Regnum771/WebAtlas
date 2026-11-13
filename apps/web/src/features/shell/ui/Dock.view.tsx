import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/shared/ui/IconButton';
import { Drawer, DrawerContent, DrawerTitle } from '@/shared/ui/shadcn/drawer';

export interface DockViewProps {
  /** `column`: the page's third column (1100 px and wider). `drawer`: a Vaul drawer over the map. */
  variant: 'column' | 'drawer';
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Where the drawer is mounted: the map stage, so it is placed against the map's box. */
  container?: HTMLElement | null;
  children: ReactNode;
}

function Header({ title, closeLabel, onClose, drawer }: { title: string; closeLabel: string; onClose: () => void; drawer: boolean }) {
  const Title = drawer ? DrawerTitle : 'h2';
  return (
    <div className="flex h-[40px] flex-none items-center justify-between gap-2 border-0 border-b border-solid border-line-2 bg-surface-2 pr-1.5 pl-3">
      <Title className="m-0 text-panel font-semibold text-ink">{title}</Title>
      <IconButton label={closeLabel} side="bottom" onClick={onClose} className="size-control-sm border-transparent bg-transparent">
        <X size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/**
 * The dock on the map's right (spec "Map with the forecast and analysis dock"): 500 px wide and
 * full height. From 1100 px it is a page column, so it never covers the map's status bar. Below,
 * it is a non-modal Vaul drawer over the map's right edge that stops above the status bar and the
 * time row (R8); the map stays usable beside it, and a swipe to the right closes it. Its z-index
 * (95) is above the routed pages (90), so Trợ lý also works on /print and /quan-ly.
 *
 * The body holds legacy content (Trợ lý) and carries no data-slot, so it sets border-solid itself.
 */
export function DockView({ variant, title, closeLabel, onClose, container, children }: DockViewProps) {
  if (variant === 'drawer') {
    return (
      <Drawer open direction="right" modal={false} container={container} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DrawerContent
          aria-label={title}
          aria-describedby={undefined}
          className="dock-drawer absolute top-0 right-0 bottom-[calc(32px+var(--time-row-height,0px))] z-[95] w-[min(var(--dock-width),calc(100%-58px))] overflow-hidden rounded-l-lg border-y"
        >
          <Header title={title} closeLabel={closeLabel} onClose={onClose} drawer />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <aside aria-label={title} className="dock flex min-h-0 flex-col border-0 border-l border-solid border-line bg-surface text-ink">
      <Header title={title} closeLabel={closeLabel} onClose={onClose} drawer={false} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
