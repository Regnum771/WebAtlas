import type { ReactNode } from 'react';

/**
 * The map tools' column at the stage's top-right corner: 32 px button stacks, 8 px apart
 * (spec "Map tools"). It takes no pointer events between its stacks.
 */
export function ToolStacksView({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="tool-stacks"
      className="pointer-events-none absolute top-2 right-2 z-10 flex flex-col items-end gap-2 [&>*]:pointer-events-auto"
    >
      {children}
    </div>
  );
}
