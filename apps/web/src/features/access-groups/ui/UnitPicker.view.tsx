import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PickerRow } from '../model/useUnitPicker';

export function UnitPickerView({ rows, query, onQuery, onToggle, onToggleExpand, mode, error, hint }: {
  rows: PickerRow[];
  query: string;
  onQuery: (q: string) => void;
  onToggle: (code: string) => void;
  onToggleExpand: (code: string) => void;
  mode: 'multi' | 'single';
  error?: string | null;
  hint?: string | null;
}) {
  const inputType = mode === 'single' ? 'radio' : 'checkbox';
  return (
    <div className="unit-picker">
      <label htmlFor="unit-picker-q">Tìm đơn vị</label>
      <input id="unit-picker-q" className="input" type="search" value={query}
        placeholder="Tên hoặc mã, không cần gõ dấu" onChange={(e) => onQuery(e.target.value)} />
      {hint && <p className="hint">{hint}</p>}
      <ul className="unit-picker-list" aria-label="Đơn vị">
        {rows.map((r) => (
          <li key={r.code} className="unit-picker-row" style={{ paddingLeft: r.depth * 20 }}>
            {r.hasChildren && r.level === 'province' ? (
              <button type="button" className="unit-picker-expand" onClick={() => onToggleExpand(r.code)}
                aria-expanded={r.expanded} aria-label={`${r.expanded ? 'Thu gọn' : 'Mở'} ${r.name}`}>
                {r.expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
            ) : <span className="unit-picker-expand" aria-hidden="true" />}
            <label>
              <input type={inputType} name="unit-picker" checked={r.selected || r.coveredByAncestor}
                disabled={r.disabled || r.coveredByAncestor} onChange={() => onToggle(r.code)} />
              {' '}{r.name} <span className="unit-picker-code">{r.code}</span>
            </label>
            {r.coveredByAncestor && <span className="hint">Đã gồm trong {r.coveredByName}</span>}
          </li>
        ))}
      </ul>
      {error && <p className="hint bad" role="alert">{error}</p>}
    </div>
  );
}
