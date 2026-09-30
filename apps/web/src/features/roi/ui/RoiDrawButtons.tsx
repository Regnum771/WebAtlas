import { useEffect, type ReactNode } from 'react';
import { Pentagon, RectangleHorizontal, Spline, MapPin } from 'lucide-react';
import type { DrawnRoiGeometry } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { claimDrawing, releaseDrawing, setDrawFeedback, useDrawFeedback } from '../../map/model/drawingState';
import { attachDrawAids, closeTolerancePx, validateShape } from '../../map/model/drawAids';
import { startRoiDraw } from '../../map/model/roiDraw';
import { setRoi, setRoiHint, startDrawing, stopDrawing, useRoi, type RoiDrawKind } from '../model/roi.store';

const KINDS: { kind: RoiDrawKind; label: string; icon: ReactNode }[] = [
  { kind: 'Polygon', label: 'Vẽ đa giác', icon: <Pentagon size={18} /> },
  { kind: 'Box', label: 'Vẽ hình chữ nhật', icon: <RectangleHorizontal size={18} /> },
  { kind: 'LineString', label: 'Vẽ đường', icon: <Spline size={18} /> },
  { kind: 'Point', label: 'Chọn một điểm', icon: <MapPin size={18} /> },
];

export function RoiDrawButtonsView({ active, onDraw }: { active: RoiDrawKind | null; onDraw: (kind: RoiDrawKind) => void }) {
  return (
    <div className="control-group" role="group" aria-label="Vẽ">
      <span className="control-group-label" aria-hidden="true">Vẽ</span>
      {KINDS.map(({ kind, label, icon }) => (
        <button
          key={kind} type="button" className={`control-btn ${active === kind ? 'active' : ''}`}
          aria-pressed={active === kind} aria-label={label} title={label} onClick={() => onDraw(kind)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/**
 * The Vẽ group and the drawing lifecycle (F1). Pressing a tool starts a drawing; pressing
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
