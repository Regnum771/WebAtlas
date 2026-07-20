import { Filter } from 'lucide-react';

export function FilterButtonView({ activeCount, onToggle }: {
  activeCount: number;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="filter-btn glass-panel" onClick={onToggle} aria-label="Bộ lọc">
      <Filter size={18} />
      {activeCount > 0 && <span className="filter-btn-badge">{activeCount}</span>}
    </button>
  );
}
