import { useId, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { CONTOUR_INTERVALS, TERRAIN_LAYER_STATE_IDS, type ContourInterval } from '@webatlas/shared';
import { dictionaryKeyFor } from '../../dictionary/model/layerKeys';
import type { PanelGroup, PanelLayer } from '../model/useLayersPanel';
import type { ContourSettings } from '../../map/model/contours';
import { Checkbox } from '../../../shared/ui/shadcn/checkbox';
import { LegendSwatch } from '../../legend/ui/LegendSwatch';

const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;

/** Type guard narrowing a raw <select> value against the shipped interval set,
 *  rather than casting Number(e.target.value) straight to ContourInterval. */
function isContourInterval(value: number): value is ContourInterval {
  return (CONTOUR_INTERVALS as readonly number[]).includes(value);
}

interface Props {
  /** The groups to draw, already narrowed by the filter. */
  groups: PanelGroup[];
  /** Layers on across every group, filtered or not. */
  onCount: number;
  onTurnAllOff: () => void;
  query: string;
  onQuery: (query: string) => void;
  /** layerStateIds the API catalog knows about but LAYER_DISPLAY does not cover. */
  missingDisplay: string[];
  onToggle: (layerStateId: string) => void;
  onOpacity: (layerStateId: string, opacity: number) => void;
  contourSettings: ContourSettings;
  onContourSettings: (next: ContourSettings) => void;
  /** Opens the attribute sheet; rows without a dictionary entry get no button. */
  onInfo?: (layerStateId: string, layerName: string) => void;
}

/**
 * Passive: the contents panel's layer section (spec "Contents panel"). A title row with the count
 * of layers on and Tắt hết, a filter, then a 32 px bar per group and a 30 px row per layer.
 */
export function LayersPanelView({
  groups,
  onCount,
  onTurnAllOff,
  query,
  onQuery,
  missingDisplay,
  onToggle,
  onOpacity,
  contourSettings,
  onContourSettings,
  onInfo,
}: Props) {
  const idBase = useId();
  // Collapsed group names; a filter shows every matching group open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const filtering = query.trim() !== '';
  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  return (
    <section data-slot="layers-panel" aria-labelledby="layers-panel-title" className="text-body text-ink">
      <div className="flex h-group-row items-center gap-2 px-3">
        <h2 id="layers-panel-title" className="text-panel font-semibold">Quản lý dữ liệu</h2>
        <span className="ml-auto text-label whitespace-nowrap text-ink-2">
          <span className="font-num">{onCount}</span> lớp bật
        </span>
        <span aria-hidden="true" className="text-label text-ink-2">·</span>
        <button
          type="button"
          className="cursor-pointer text-label font-semibold text-water hover:underline disabled:cursor-default disabled:font-normal disabled:text-ink-2 disabled:no-underline"
          disabled={onCount === 0}
          onClick={onTurnAllOff}
        >
          Tắt hết
        </button>
      </div>
      <div className="px-3 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Lọc lớp"
          placeholder="Lọc lớp theo tên"
          className="h-control-sm w-full rounded-md border border-ink-2 bg-surface px-2 text-body text-ink placeholder:text-ink-2"
        />
      </div>
      {missingDisplay.length > 0 && (
        <p role="status" className="mx-3 mb-2 rounded-md border border-notice-line bg-notice-tint px-2 py-1 text-label">
          {missingDisplay.length} lớp có trong hệ thống nhưng chưa có mô tả hiển thị:{' '}
          {missingDisplay.join(', ')}
        </p>
      )}
      {groups.length === 0 && (
        <p role="status" className="px-3 py-2 text-ink-2">Không có lớp phù hợp.</p>
      )}
      {groups.map((group, index) => {
        const open = filtering || !collapsed.has(group.name);
        const listId = `${idBase}-group-${index}`;
        return (
          <div key={group.name} data-slot="layers-group">
            <h3>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggleGroup(group.name)}
                className="flex h-group-row w-full cursor-pointer items-center gap-1.5 border-t border-line-3 bg-surface-2 px-3 text-left text-label font-semibold tracking-wide text-ink-2 uppercase"
              >
                <ChevronDown size={14} aria-hidden="true" className="shrink-0 transition-transform duration-[var(--motion-base)] data-[closed]:-rotate-90" data-closed={open ? undefined : ''} />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="font-num text-num font-normal tracking-normal text-ink-2 normal-case" aria-label={`${group.on} trên ${group.total} lớp bật`}>
                  {group.on}/{group.total}
                </span>
              </button>
            </h3>
            {open && (
              <ul id={listId} className="py-0.5">
                {group.layers.map((layer) => (
                  <LayerRow
                    key={layer.id}
                    layer={layer}
                    onToggle={onToggle}
                    onOpacity={onOpacity}
                    contourSettings={contourSettings}
                    onContourSettings={onContourSettings}
                    onInfo={onInfo}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

function LayerRow({
  layer,
  onToggle,
  onOpacity,
  contourSettings,
  onContourSettings,
  onInfo,
}: { layer: PanelLayer } & Pick<Props, 'onToggle' | 'onOpacity' | 'contourSettings' | 'onContourSettings' | 'onInfo'>) {
  const id = useId();
  return (
    <li data-slot="layer-row" data-layer={layer.id} data-gated={layer.gated || undefined}>
      <div className="flex h-row items-center gap-2 pr-2 pl-3">
        <Checkbox id={id} checked={layer.visible} onCheckedChange={() => onToggle(layer.id)} />
        <LegendSwatch entry={layer.swatch} />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate in-data-[gated]:text-ink-2" title={layer.name}>
          {layer.name}
        </label>
        {layer.scaleNote && (
          <span
            className="font-num text-[11px] whitespace-nowrap text-ink-2 in-data-[gated]:font-semibold in-data-[gated]:text-ink"
            title={layer.gated ? 'Chưa hiện ở tỷ lệ này' : undefined}
          >
            {layer.scaleNote}
          </span>
        )}
        {layer.visible && !layer.gated && (
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={layer.opacity}
            aria-label={`Độ mờ ${layer.name}`}
            onChange={(e) => onOpacity(layer.id, parseFloat(e.target.value))}
            className="h-1 w-14 shrink-0 cursor-pointer accent-brand"
          />
        )}
        {onInfo && dictionaryKeyFor(layer.id) && (
          <button
            type="button"
            data-dictionary-info={layer.id}
            aria-label={`Thuộc tính của ${layer.name}`}
            onClick={() => onInfo(layer.id, layer.name)}
            className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <Info size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {layer.id === CONTOURS && layer.visible && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1.5 pl-9 text-label">
          <label className="flex items-center gap-1.5">
            <span>Khoảng cao đều</span>
            <select
              aria-label="Khoảng cao đều"
              value={String(contourSettings.interval)}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === 'auto') {
                  onContourSettings({ ...contourSettings, interval: 'auto' });
                  return;
                }
                const parsed = Number(raw);
                if (isContourInterval(parsed)) {
                  onContourSettings({ ...contourSettings, interval: parsed });
                }
              }}
              className="h-6 cursor-pointer rounded-md border border-ink-2 bg-surface px-1 text-label"
            >
              <option value="auto">Tự động theo mức thu phóng</option>
              {CONTOUR_INTERVALS.map((m) => (
                <option key={m} value={m}>{m} m</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="Nhãn độ cao"
              checked={contourSettings.labels}
              onChange={(e) => onContourSettings({ ...contourSettings, labels: e.target.checked })}
              className="accent-brand"
            />
            <span>Nhãn độ cao</span>
          </label>
        </div>
      )}
    </li>
  );
}
