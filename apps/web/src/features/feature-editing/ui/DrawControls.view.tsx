import type { OgcGeometryType } from '@webatlas/shared';
import { Button } from '../../../shared/ui/Button';

export interface DrawControlsViewProps {
  geomType: string | null;
  mode: 'idle' | 'drawing' | 'form';
  onStartDraw: () => void;
  onCancel: () => void;
}

const GEOM_LABELS: Record<OgcGeometryType, string> = {
  Point: 'điểm',
  MultiLineString: 'đường',
  MultiPolygon: 'vùng',
};

// Passive: draw / cancel controls + hint text.
export function DrawControlsView({ geomType, mode, onStartDraw, onCancel }: DrawControlsViewProps) {
  const shape = geomType ? (GEOM_LABELS[geomType as OgcGeometryType] ?? geomType) : null;
  return (
    <div className="edit-draw-controls">
      <Button variant="solid" onClick={onStartDraw} disabled={!geomType || mode !== 'idle'}>
        {mode === 'drawing' ? 'Đang vẽ' : 'Vẽ'}
      </Button>
      {mode !== 'idle' && <Button onClick={onCancel}>Huỷ</Button>}
      {shape && mode === 'idle' && <p className="edit-hint">Bấm Vẽ rồi đặt {shape} lên bản đồ.</p>}
      {mode === 'drawing' && <p className="edit-hint">Vẽ {shape} lên bản đồ để tiếp tục.</p>}
    </div>
  );
}
