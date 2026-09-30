import type { Roi } from '@webatlas/shared';
import { setRoi } from '../model/roi.store';

/** The single "Dùng làm vùng phân tích" control (FR-11). Picks fit the map (U-5). */
export function UseAsRoiButton({ roi, label }: { roi: Roi; label: string }) {
  return (
    <button
      type="button" className="use-as-roi" aria-label={`Dùng ${label} làm vùng phân tích`}
      title="Dùng làm vùng phân tích"
      onClick={(e) => { e.stopPropagation(); void setRoi(roi, { fit: true }); }}
    >
      Dùng
    </button>
  );
}
