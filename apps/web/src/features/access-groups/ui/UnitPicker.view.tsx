import { useId } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PickerRow } from '../model/useUnitPicker';
import { ui } from '../../../shared/ui/styles';

export function UnitPickerView({ rows, query, onQuery, onToggle, onToggleExpand, selectedItems, mode, error, hint }: {
  rows: PickerRow[];
  query: string;
  onQuery: (q: string) => void;
  onToggle: (code: string) => void;
  onToggleExpand: (code: string) => void;
  selectedItems: Array<{ code: string; name: string }>;
  mode: 'multi' | 'single';
  error?: string | null;
  hint?: string | null;
}) {
  const uid = useId();
  const inputType = mode === 'single' ? 'radio' : 'checkbox';
  return (
    // A converted scope used in two places: the group form and the feature editor's unit field.
    <div data-slot="unit-picker" className="flex flex-col gap-1.5 text-body text-ink">
      {selectedItems.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className={ui.hint}>Đã chọn:</span>
          {selectedItems.map((it) => (
            <span key={it.code} className="inline-flex items-center gap-1 rounded-sm border border-brand-line bg-brand-tint pl-1.5 text-label text-brand">
              {it.name}
              {mode === 'multi' && (
                <button type="button" aria-label={`Bỏ ${it.name}`} onClick={() => onToggle(it.code)}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm hover:bg-surface">×</button>
              )}
            </span>
          ))}
        </p>
      )}
      <label htmlFor={`${uid}-q`} className="text-label font-semibold text-ink-2">Tìm đơn vị</label>
      <input id={`${uid}-q`} type="search" value={query}
        placeholder="Tên hoặc mã, không cần gõ dấu" onChange={(e) => onQuery(e.target.value)}
        className="h-control w-full rounded-md border border-ink-2 bg-surface px-2 text-body placeholder:text-ink-2" />
      {hint && <p className={`${ui.hint} text-label`}>{hint}</p>}
      <ul className="m-0 max-h-60 list-none overflow-y-auto rounded-md border border-solid border-line p-0" aria-label="Đơn vị">
        {rows.map((r) => (
          <li key={r.code} data-code={r.code} className="flex min-h-row items-center gap-1.5 border-t border-line-3 pr-2 first:border-t-0" style={{ paddingLeft: 4 + r.depth * 20 }}>
            {r.hasChildren && r.level === 'province' ? (
              <button type="button" onClick={() => onToggleExpand(r.code)}
                aria-expanded={r.expanded} aria-label={`${r.expanded ? 'Thu gọn' : 'Mở'} ${r.name}`}
                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink hover:bg-surface-2">
                {r.expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
            ) : <span className="inline-block size-5 shrink-0" aria-hidden="true" />}
            <label className={`${ui.check} min-w-0 flex-1`}>
              <input type={inputType} name={`${uid}-unit`} checked={r.selected || r.coveredByAncestor}
                disabled={r.disabled || r.coveredByAncestor} onChange={() => onToggle(r.code)} />
              <span>{r.name} <span className="font-num text-[11px] text-ink-2">{r.code}</span></span>
            </label>
            {r.coveredByAncestor && <span className={`${ui.hint} text-label whitespace-nowrap`}>Đã gồm trong {r.coveredByName}</span>}
          </li>
        ))}
      </ul>
      {error && <p className={ui.fieldError} role="alert">{error}</p>}
    </div>
  );
}
