import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface ToolDef {
  id: string;
  label: string;
  /** The tool holds something even while its menu is closed, so its button stays filled. */
  on?: boolean;
  content: ReactNode;
}

export interface ToolGroupViewProps {
  tools: ToolDef[];
  /** Id of the tool whose menu is open; null when all are closed. */
  open: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
}

/**
 * Passive view: one text button per tool, each with a menu. Every menu stays mounted,
 * so a tool keeps its state and its effects while closed; all but the open one are hidden.
 */
export function ToolGroupView({ tools, open, onToggle, onClose }: ToolGroupViewProps) {
  const baseId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const menuId = (id: string) => `${baseId}-menu-${id}`;

  // Escape with focus in the group or in a menu closes the open menu and hands focus back to its button.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || open === null) return;
    onClose();
    buttons.current.get(open)?.focus();
  };

  return (
    <>
      <div className="tool-group float" onKeyDown={onKeyDown}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            ref={(el) => {
              if (el) buttons.current.set(tool.id, el);
              else buttons.current.delete(tool.id);
            }}
            type="button"
            className={tool.on || open === tool.id ? 'tool-btn is-on' : 'tool-btn'}
            aria-expanded={open === tool.id}
            aria-controls={menuId(tool.id)}
            onClick={() => onToggle(tool.id)}
          >
            {tool.label}
          </button>
        ))}
      </div>
      {tools.map((tool) => (
        <section
          key={tool.id}
          id={menuId(tool.id)}
          className="tool-menu float"
          role="region"
          aria-label={tool.label}
          hidden={open !== tool.id}
          onKeyDown={onKeyDown}
        >
          {tool.content}
        </section>
      ))}
    </>
  );
}
