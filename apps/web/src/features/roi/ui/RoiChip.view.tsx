import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { ROI_MAX_RADIUS_KM, type Roi } from '@webatlas/shared';
import { Spinner } from '../../../shared/ui/Spinner';
import { KIND_LABELS, formatMeasure } from '../model/format';
import type { RoiDrawKind, RoiState } from '../model/roi.store';

const DRAW_HINTS: Record<RoiDrawKind, string> = {
  Polygon: 'Nhấp để vẽ · nhấp đúp hoặc Enter để kết thúc · giữ Shift và kéo để vẽ tay · giữ Alt để tắt bắt dính · Backspace xoá điểm · Esc để huỷ',
  Box: 'Nhấp hai góc đối nhau · Esc để huỷ',
  LineString: 'Nhấp để vẽ · nhấp đúp hoặc Enter để kết thúc · giữ Shift và kéo để vẽ tay · giữ Alt để tắt bắt dính · Backspace xoá điểm · Esc để huỷ',
  Point: 'Nhấp để chọn điểm · Esc để huỷ',
};
const PRESETS = [1, 2, 5, 10];

function radiusOf(roi: Roi | null): number | null {
  return roi && roi.source !== 'admin' ? roi.radiusKm ?? null : null;
}
const validRadius = (n: number) => Number.isFinite(n) && n > 0 && n <= ROI_MAX_RADIUS_KM;

export interface RoiChipViewProps {
  state: RoiState;
  /** While drawing, the aid's current hint (U-11), overriding the default for the kind. */
  drawHint?: string | null;
  liveMeasure?: string | null;
  onRadius: (km: number | null) => void;
  onClear: () => void;
  onDismiss: () => void;
}

/**
 * The region status at the top of the Vùng phân tích menu: its five states (U-3) and the
 * radius editor (U-4). Idle with no region and nothing to report, it renders nothing.
 */
export function RoiChipView({ state, drawHint, liveMeasure, onRadius, onClear, onDismiss }: RoiChipViewProps) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { setEditing(false); }, [state.resolved]);
  const current = radiusOf(state.roi);
  const [draft, setDraft] = useState(String(current ?? 5));
  const r = state.resolved;
  const canRadius = !!r && (r.kind !== 'area' || current !== null);

  const apply = (km: number | null) => {
    if (km !== null && !validRadius(km)) return;
    setEditing(false);
    onRadius(km);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') apply(Number(draft));
    if (e.key === 'Escape') {
      // Esc belongs to the editor here: it must not also close the menu around it.
      e.stopPropagation();
      setEditing(false);
    }
  };

  let body: ReactNode;
  if (state.status === 'drawing' && state.drawKind) {
    body = (
      <>
        <span className="roi-status-muted">{drawHint ?? DRAW_HINTS[state.drawKind]}</span>
        {liveMeasure && <span className="roi-status-measure">{liveMeasure}</span>}
      </>
    );
  } else if (state.status === 'resolving') {
    body = (<><Spinner /><span className="roi-status-muted">Đang xác định vùng…</span></>);
  } else if (!r) {
    // No region: the analysis tools' shared line below already says what to do.
    body = null;
  } else if (editing) {
    body = (
      <>
        <b className="roi-status-label" title={r.label}>{r.label}</b>
        <span className="roi-status-muted">+</span>
        <input
          type="number" min={0.1} max={ROI_MAX_RADIUS_KM} step={0.1} value={draft} autoFocus
          aria-label="Bán kính (km)" onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
        />
        <span className="roi-status-muted">km</span>
        {PRESETS.map((km) => (
          <button key={km} type="button" className="link" aria-label={`${km} km`} onClick={() => apply(km)}>{km}</button>
        ))}
        <button type="button" className="link roi-status-glyph" aria-label="Áp dụng bán kính" disabled={!validRadius(Number(draft))} onClick={() => apply(Number(draft))}>✓</button>
        {current !== null && <button type="button" className="link" onClick={() => apply(null)}>Bỏ bán kính</button>}
      </>
    );
  } else {
    const measure = formatMeasure(r.measure);
    body = (
      <>
        <span className="roi-status-muted">Vùng phân tích:</span>
        <b className="roi-status-label" title={r.label}>{r.label}</b>
        <span className="roi-status-measure">{`· ${KIND_LABELS[r.kind]}${measure ? ` · ${measure}` : ''}`}</span>
        {canRadius && (
          <button type="button" className="link" onClick={() => { setDraft(String(current ?? 5)); setEditing(true); }}>
            {current === null ? 'Bán kính' : `Bán kính: ${current} km`}
          </button>
        )}
        <button type="button" className="link roi-status-glyph" aria-label="Bỏ vùng phân tích" onClick={onClear}>✕</button>
      </>
    );
  }

  if (body === null && !state.error && !state.hint) return null;

  return (
    <div className="roi-status" role="status">
      {body}
      {(state.error || state.hint) && (
        <>
          <span className={state.error ? 'roi-status-error' : 'roi-status-muted'} role={state.error ? 'alert' : undefined}>
            {state.error && <CircleAlert size={14} aria-hidden="true" />}
            {state.error ?? state.hint}
          </span>
          <button type="button" className="link roi-status-glyph" aria-label="Đóng thông báo" onClick={onDismiss}>×</button>
        </>
      )}
    </div>
  );
}
