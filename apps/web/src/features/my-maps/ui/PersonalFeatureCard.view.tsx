import { X } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import type { PersonalCardRow } from '../model/usePersonalPopupPresenter';

interface Props {
  title: string;
  rows: PersonalCardRow[];
  /** The clicked point in window coordinates. */
  anchor: [number, number];
  /** False for a multi-part geometry: the button is disabled and says why. */
  canUseAsRoi: boolean;
  onUseAsRoi: () => void;
  onClose: () => void;
}

// The card's estimated size, as DynamicPopup estimates the official popup's.
const CARD_WIDTH = 260;
const CARD_HEIGHT = 350;

/** Passive: a personal feature's card beside the click — the layer title and one `key: value` row per property. */
export function PersonalFeatureCardView({ title, rows, anchor, canUseAsRoi, onUseAsRoi, onClose }: Props) {
  const [x, y] = anchor;
  // Beside the pointer, flipped left or below when it would leave the window.
  const flipX = x + 15 + CARD_WIDTH > window.innerWidth;
  const flipY = y - 15 - CARD_HEIGHT < 0;
  return (
    <div
      className="dynamic-popup float personal-feature-card"
      style={{
        left: flipX ? x - 15 : x + 15,
        top: flipY ? y + 15 : y - 15,
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '0' : '-100%'})`,
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      <button type="button" className="close-popup-btn" aria-label="Đóng" title="Đóng" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
      <div className="popup-header">
        <h3 className="popup-title">{title}</h3>
      </div>
      <div className="popup-content">
        {rows.map((row) => (
          <p key={row.key} className="info-row">{`${row.key}: ${row.value}`}</p>
        ))}
        <Button size="sm" onClick={onUseAsRoi} disabled={!canUseAsRoi}>Dùng làm vùng phân tích</Button>
        {!canUseAsRoi && <p className="info-row">Đối tượng nhiều phần chưa dùng được làm vùng phân tích.</p>}
      </div>
    </div>
  );
}
