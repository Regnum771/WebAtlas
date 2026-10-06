import { useEffect, useId, type ReactNode } from 'react';
import { Pentagon, RectangleHorizontal, Spline, MapPin } from 'lucide-react';
import type { DrawnRoiGeometry } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';
import { useMapContext } from '../../../app/providers/MapProvider';
import { claimDrawing, releaseDrawing, setDrawFeedback, useDrawFeedback } from '../../map/model/drawingState';
import { attachDrawAids, closeTolerancePx, validateShape } from '../../map/model/drawAids';
import { startRoiDraw } from '../../map/model/roiDraw';
import { setRoi, setRoiHint, startDrawing, stopDrawing, useRoi, type RoiDrawKind } from '../model/roi.store';

/** `label` is the full accessible name; `text` is the short word shown beside the icon. */
const KINDS: { kind: RoiDrawKind; label: string; text: string; icon: ReactNode }[] = [
  { kind: 'Polygon', label: 'Vẽ đa giác', text: 'Đa giác', icon: <Pentagon size={16} aria-hidden="true" /> },
  { kind: 'Box', label: 'Vẽ hình chữ nhật', text: 'Hình chữ nhật', icon: <RectangleHorizontal size={16} aria-hidden="true" /> },
  { kind: 'LineString', label: 'Vẽ đường', text: 'Đường', icon: <Spline size={16} aria-hidden="true" /> },
  { kind: 'Point', label: 'Chọn một điểm', text: 'Điểm', icon: <MapPin size={16} aria-hidden="true" /> },
];

export function RoiDrawButtonsView({ active, onDraw }: { active: RoiDrawKind | null; onDraw: (kind: RoiDrawKind) => void }) {
  const headingId = useId();
  return (
    <div className="tool-section" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="tool-heading">Vẽ vùng</h3>
      <div className="tool-buttons">
        {KINDS.map(({ kind, label, text, icon }) => (
          <Button
            key={kind} size="sm" variant={active === kind ? 'solid' : 'outline'}
            aria-pressed={active === kind} aria-label={label} onClick={() => onDraw(kind)}
          >
            {icon}{text}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The Vẽ vùng group and the drawing lifecycle (F1). Pressing a tool starts a drawing; pressing
 * it again, or Esc, cancels. A finished shape becomes the ROI, with no fit — it is on
 * screen by construction (U-5).
 */
export default function RoiDrawButtons() {
  const { map } = useMapContext();
  const roi = useRoi();
  const { owner } = useDrawFeedback();
  const drawing = roi.status === 'drawing' ? roi.drawKind : null;

  useEffect(() => {
    if (!map || !drawing) return;
    claimDrawing('roi');
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
    const stop = startRoiDraw(
      map,
      drawing,
      (geometry) => { void setRoi({ source: 'drawn', geometry: geometry as DrawnRoiGeometry }, { fit: false }); },
      {
        snapTolerancePx: closeTolerancePx(coarse),
        onDrawCreated: (draw) => attachDrawAids(map, draw, {
          onHint: (hint) => setDrawFeedback({ hint }),
          onMeasure: (measure) => setDrawFeedback({ measure }),
          onCancel: stopDrawing,
        }),
        validate: validateShape,
        onInvalid: (message) => setRoiHint(message),
      }
    );
    return () => {
      stop();
      releaseDrawing('roi');
    };
  }, [map, drawing]);

  // The ruler took the map's clicks: stop drawing an ROI.
  useEffect(() => {
    if (owner === 'ruler' && drawing) stopDrawing();
  }, [owner, drawing]);

  return <RoiDrawButtonsView active={drawing} onDraw={(kind) => (drawing === kind ? stopDrawing() : startDrawing(kind))} />;
}
