import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface CardMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface Props {
  items: CardMenuItem[];
}

/**
 * The ⋯ button of a map card and the menu it opens below it. Escape, an outside click and a
 * choice close it; arrow keys move focus between the items; closing returns focus to the button.
 */
export function CardMenuView({ items }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus the first item on opening.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // An outside click closes the menu; focus stays where the click put it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = (at + step + items.length) % items.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <div className="card-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="btn quiet sm card-menu-button"
        aria-label="Thao tác khác"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu-list" role="menu">
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              className={item.danger ? 'card-menu-item danger' : 'card-menu-item'}
              onClick={() => { close(); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
