import type { ReactNode } from 'react';
import type { RailItemId } from '../model/useRail';

export interface RailItem {
  id: RailItemId;
  label: string;
  icon?: ReactNode;
}

interface Props {
  items: RailItem[];
  active: RailItemId | null;
  onToggle: (id: RailItemId) => void;
}

/** Passive: the dark icon rail. All state lives in useRail. */
export function IconRail({ items, active, onToggle }: Props) {
  return (
    <nav className="icon-rail" aria-label="Bảng điều khiển">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`icon-rail-btn ${active === item.id ? 'active' : ''}`}
          aria-pressed={active === item.id}
          aria-label={item.label}
          title={item.label}
          onClick={() => onToggle(item.id)}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
