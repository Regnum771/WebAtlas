import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '../../../shared/ui/IconButton';

/** The tool stacks, top to bottom, under the zoom stack (spec "Map tools"). */
export const TOOL_STACKS = ['analysis', 'data', 'basemap'] as const;
export type ToolStack = (typeof TOOL_STACKS)[number];

const STACK_LABELS: Record<ToolStack, string> = {
  analysis: 'Đo và phân tích',
  data: 'Dữ liệu',
  basemap: 'Nền bản đồ',
};

export interface ToolDef {
  id: string;
  label: string;
  /** The button's icon, decorative. */
  icon: ReactNode;
  stack: ToolStack;
  /** The tool holds something even while its menu is closed, so its button stays tinted. */
  on?: boolean;
  /** The menu body. Absent for a button that opens another tool's menu (`opens`) or runs `onSelect`. */
  content?: ReactNode;
  /** Opens the menu of the tool with this id (Trắc diện độ cao opens Vùng phân tích's). */
  opens?: string;
  /** Runs instead of opening a menu (In và xuất). */
  onSelect?: () => void;
}

export interface ToolGroupViewProps {
  tools: ToolDef[];
  /** Id of the tool whose menu is open; null when all are closed. */
  open: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
  /** Drawn first in the column: the zoom stack. */
  before?: ReactNode;
}

/**
 * Passive view: the map tools at the stage's top-right corner, 32 px icon buttons in grouped
 * stacks 8 px apart, and the tools' menus in a column to their left. One menu is open at a time.
 *
 * Every menu stays mounted, hidden while closed, so a tool keeps its state and its effects. The
 * menu column runs from the stage's top to 8 px above the status bar, so a menu scrolls inside it
 * and never covers the bar (R8). A press on the map leaves a menu open (measuring and drawing a
 * region happen there); Escape closes it and hands focus back to its button.
 */
export function ToolGroupView({ tools, open, onToggle, onClose, before }: ToolGroupViewProps) {
  const baseId = useId();
  const menuId = (id: string) => `${baseId}-menu-${id}`;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || open === null) return;
    onClose();
    buttons.current.get(open)?.focus();
  };

  return (
    <>
      <div
        data-slot="tool-stacks"
        className="tool-group pointer-events-none absolute top-2 right-2 z-10 flex flex-col items-end gap-2 [&>*]:pointer-events-auto"
        onKeyDown={onKeyDown}
      >
        {before}
        {TOOL_STACKS.map((stack) => {
          const inStack = tools.filter((t) => t.stack === stack);
          if (inStack.length === 0) return null;
          return (
            <div key={stack} role="group" aria-label={STACK_LABELS[stack]} data-slot="tool-stack" className="flex flex-col gap-1">
              {inStack.map((tool) => {
                const target = tool.opens ?? (tool.content !== undefined ? tool.id : null);
                const expanded = target !== null && open === target;
                return (
                  <IconButton
                    key={tool.id}
                    ref={(el: HTMLButtonElement | null) => {
                      if (el) buttons.current.set(tool.id, el);
                      else buttons.current.delete(tool.id);
                    }}
                    label={tool.label}
                    aria-expanded={target !== null ? expanded : undefined}
                    aria-controls={target !== null ? menuId(target) : undefined}
                    data-on={tool.on || expanded || undefined}
                    className="data-[on]:border-brand-line data-[on]:bg-brand-tint data-[on]:text-brand"
                    onClick={() => {
                      if (tool.onSelect) tool.onSelect();
                      else if (target) onToggle(target);
                    }}
                  >
                    {tool.icon}
                  </IconButton>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* The menu column: left of the stacks (8 px + 32 px + 8 px from the edge), above the status bar. */}
      <div className="pointer-events-none absolute top-2 right-12 bottom-10 z-20 flex w-[min(320px,calc(100%-64px))] flex-col items-stretch">
        {tools.filter((t) => t.content !== undefined).map((tool) => (
          // Not a primitive scope: the menu bodies are legacy and keep the browser defaults, so
          // the panel sets border-solid itself.
          <section
            key={tool.id}
            id={menuId(tool.id)}
            role="region"
            aria-label={tool.label}
            hidden={open !== tool.id}
            onKeyDown={onKeyDown}
            className="tool-menu pointer-events-auto max-h-full min-h-0 overflow-y-auto rounded-lg border border-solid border-line bg-surface p-3 text-body text-ink shadow-pop"
          >
            {tool.content}
          </section>
        ))}
      </div>
    </>
  );
}
