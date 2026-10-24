import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { Message } from '../../../shared/ui/Message';
import type {
  ConditionPatch, ConditionView, TableColumnView, TablePage, TableRowView,
} from '../model/useTablePresenter';
import { ConditionEditorView } from './ConditionEditor.view';

interface Props {
  /** The open layer's id: an editor open on one layer's condition does not carry over to another's. */
  layerId?: string;
  title: string;
  /** null until the first answer. */
  total: number | null;
  matched: number | null;
  q: string;
  conditions: ConditionView[];
  /** The columns a condition can test. */
  fields: TableColumnView[];
  canAddCondition: boolean;
  match: 'all' | 'any';
  inView: boolean;
  columns: TableColumnView[];
  rows: TableRowView[];
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  page: TablePage;
  loading: boolean;
  error: string | null;
  /** Present for a network error only: a refused filter is fixed by changing the filter. */
  onRetry?: () => void;
  onSearch: (q: string) => void;
  onAddCondition: () => void;
  onUpdateCondition: (index: number, patch: ConditionPatch) => void;
  onRemoveCondition: (index: number) => void;
  onMatch: (match: 'all' | 'any') => void;
  onInView: (inView: boolean) => void;
  onSort: (field: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** The selected feature's id; its row is marked when it is on the page. */
  selectedId: string | null;
  /** The selected feature does not match the filter: a note shows above the rows. */
  selectedOutsideFilter: boolean;
  canZoom: boolean;
  onSelectRow: (id: string) => void;
  /** Phóng tới: to the selection, or to the rows on the page. */
  onZoom: () => void;
  /** Vẽ thêm into this layer; absent for a recipient. */
  onDraw?: () => void;
  /** False for a layer nothing can be drawn into (a mixed-geometry import): Vẽ thêm is disabled. */
  canDraw?: boolean;
  /** The selected feature's form (or Vẽ thêm's hint), beside the rows. */
  children?: ReactNode;
}

/** The dock's height as a share of the map stage, and the range its top edge can be dragged in. */
const DOCK_DEFAULT = 40;
const DOCK_MIN = 20;
const DOCK_MAX = 70;
const DOCK_STEP = 5;
const clampDock = (pct: number) => Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, pct)) * 10) / 10;

const count = (n: number) => n.toLocaleString('vi-VN');
/**
 * The selected row scrolls into view inside the table (a feature clicked on the map, or found on
 * another page); `nearest` leaves a row already in view where it is.
 */
const showSelected = (row: HTMLTableRowElement | null) => { row?.scrollIntoView?.({ block: 'nearest' }); };
/** A code column's chip names its value; any other shows the value as typed. */
const chipValue = (c: ConditionView) => c.options?.find((o) => o.value === c.value)?.label ?? c.value;
const chipText = (c: ConditionView) => (c.needsValue ? `${c.fieldLabel} ${c.opLabel} ${chipValue(c)}` : `${c.fieldLabel} ${c.opLabel}`);

/**
 * The table of one personal layer, docked under the map: the toolbar (counts, search, condition
 * chips, match, in view, Vẽ thêm, zoom, close), the rows with their symbols, the selected
 * feature's form beside them, and the paging line. A row click (or Enter on a focused row) selects it. Its top edge drags to resize it between 20 % and
 * 70 % of the map stage.
 */
export function LayerTableView(p: Props) {
  const [height, setHeight] = useState(DOCK_DEFAULT);
  const [editing, setEditing] = useState<{ layerId?: string; index: number } | null>(null);
  const section = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; start: number; stage: number } | null>(null);

  const editingIndex = editing && editing.layerId === p.layerId ? editing.index : null;
  const edited = editingIndex === null ? undefined : p.conditions[editingIndex];

  return (
    <section ref={section} className="layer-table" aria-label={p.title} style={{ height: `${height}%` }}>
      <div
        className="layer-table-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Đổi chiều cao bảng"
        aria-valuenow={height}
        aria-valuemin={DOCK_MIN}
        aria-valuemax={DOCK_MAX}
        tabIndex={0}
        onPointerDown={(e) => {
          const stage = section.current?.parentElement?.getBoundingClientRect().height ?? 0;
          if (stage <= 0) return;
          drag.current = { y: e.clientY, start: height, stage };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setHeight(clampDock(d.start + ((d.y - e.clientY) / d.stage) * 100));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') setHeight((h) => clampDock(h + DOCK_STEP));
          else if (e.key === 'ArrowDown') setHeight((h) => clampDock(h - DOCK_STEP));
          else return;
          e.preventDefault();
        }}
      />

      <div className="layer-table-toolbar">
        <h2 className="layer-table-title">{p.title}</h2>
        {p.total !== null && p.matched !== null && (
          <span className="layer-table-count">{`${count(p.total)} đối tượng · ${count(p.matched)} khớp`}</span>
        )}
        <input
          type="search"
          className="input layer-table-search"
          placeholder="Tìm…"
          value={p.q}
          onChange={(e) => p.onSearch(e.target.value)}
        />
        {p.conditions.map((c, i) => (
          <span key={i} className={editingIndex === i ? 'layer-table-chip on' : 'layer-table-chip'}>
            <button
              type="button"
              className="layer-table-chip-text"
              aria-expanded={editingIndex === i}
              onClick={() => setEditing(editingIndex === i ? null : { layerId: p.layerId, index: i })}
            >
              {chipText(c)}
            </button>
            <button
              type="button"
              className="layer-table-chip-remove"
              aria-label={`Bỏ điều kiện ${chipText(c)}`}
              onClick={() => {
                if (editingIndex !== null && editingIndex >= i) setEditing(null);
                p.onRemoveCondition(i);
              }}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <Button
          size="sm"
          variant="quiet"
          disabled={!p.canAddCondition}
          onClick={() => {
            setEditing({ layerId: p.layerId, index: p.conditions.length });
            p.onAddCondition();
          }}
        >
          + Thêm điều kiện
        </Button>
        <select
          className="input layer-table-match"
          aria-label="Cách nối điều kiện"
          value={p.match}
          onChange={(e) => p.onMatch(e.target.value as 'all' | 'any')}
        >
          <option value="all">Tất cả điều kiện</option>
          <option value="any">Một trong các điều kiện</option>
        </select>
        <label className="layer-table-inview">
          <input type="checkbox" checked={p.inView} onChange={(e) => p.onInView(e.target.checked)} />
          Chỉ trong khung nhìn
        </label>
        <span className="layer-table-actions">
          {p.onDraw && (
            <Button
              size="sm"
              variant="quiet"
              disabled={!p.canDraw}
              title={p.canDraw ? undefined : 'Lớp này không vẽ thêm được'}
              onClick={p.onDraw}
            >
              Vẽ thêm
            </Button>
          )}
          <Button size="sm" variant="quiet" disabled={!p.canZoom} onClick={p.onZoom}>Phóng tới</Button>
          <Button size="sm" onClick={p.onClose}>Đóng</Button>
        </span>
      </div>

      {edited && editingIndex !== null && (
        <ConditionEditorView
          key={`${p.layerId ?? ''}:${editingIndex}`}
          condition={edited}
          fields={p.fields}
          onChange={(patch) => p.onUpdateCondition(editingIndex, patch)}
          onDone={() => setEditing(null)}
        />
      )}
      {edited?.error && (
        <div className="layer-table-error">
          <Message tone="error" title={edited.error} />
        </div>
      )}

      {p.error && (
        <div className="layer-table-error">
          <Message
            tone="error"
            title={p.error}
            actions={p.onRetry && <Button size="sm" onClick={p.onRetry}>Thử lại</Button>}
          />
        </div>
      )}

      {p.selectedOutsideFilter && <p className="layer-table-note" role="status">Đối tượng này không khớp bộ lọc</p>}

      <div className="layer-table-body">
        {/* The rows scroll; the form keeps its own column at the right. */}
        <div className="layer-table-scroll">
          <table className={p.loading ? 'layer-table-grid loading' : 'layer-table-grid'} aria-label={p.title} aria-busy={p.loading}>
            <thead>
              <tr>
                <th scope="col" className="layer-table-symbol">Ký hiệu</th>
                {p.columns.map((c) => {
                  const dir = p.sort?.field === c.name ? p.sort.dir : null;
                  return (
                    <th
                      key={c.name}
                      scope="col"
                      title={c.definition}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    >
                      <button type="button" className="layer-table-sort" onClick={() => p.onSort(c.name)}>
                        {c.label}
                        {dir && <span aria-hidden="true">{dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr
                  key={r.id}
                  ref={r.id === p.selectedId ? showSelected : undefined}
                  className={r.id === p.selectedId ? 'layer-table-row selected' : 'layer-table-row'}
                  aria-selected={r.id === p.selectedId}
                  tabIndex={0}
                  onClick={() => p.onSelectRow(r.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    p.onSelectRow(r.id);
                  }}
                >
                  <td className="layer-table-symbol">
                    {r.symbol && <img src={r.symbol} alt="" width={20} height={16} />}
                  </td>
                  {r.cells.map((text, i) => <td key={p.columns[i]?.name ?? i}>{text}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.children}
      </div>

      <div className="layer-table-paging">
        <span>{`${p.page.from}–${p.page.to} / ${p.matched ?? 0}`}</span>
        <Button size="sm" variant="quiet" disabled={!p.page.canPrev} onClick={p.onPrev}>Trước</Button>
        <Button size="sm" variant="quiet" disabled={!p.page.canNext} onClick={p.onNext}>Sau</Button>
      </div>
    </section>
  );
}
