import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { Spinner } from '../../../shared/ui/Spinner';
import type { MapCardData } from '../model/useMyMapsPanelPresenter';
import { LayerRowView } from './LayerRow.view';

interface Props {
  card: MapCardData;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onUpload: () => void;
  onLayerVisible: (layerId: string, visible: boolean) => void;
  onLayerOpacity: (layerId: string, opacity: number) => void;
}

/** A map in the list: its title, owner and layer count; expanded, its layers and (for the owner) the actions. */
export function MapCardView({ card, onToggle, onRename, onDelete, onUpload, onLayerVisible, onLayerOpacity }: Props) {
  const Chevron = card.expanded ? ChevronDown : ChevronRight;
  return (
    <li className="my-map-card">
      <button type="button" className="my-map-head" aria-expanded={card.expanded} onClick={onToggle}>
        <Chevron size={16} aria-hidden="true" />
        <span className="my-map-title">{card.title}</span>
      </button>
      <p className="my-map-meta">
        {card.ownerLabel ? `${card.ownerLabel} · ` : ''}{card.layerCount} lớp
      </p>
      {card.expanded && (
        <div className="my-map-body">
          {card.layers === null ? <Spinner /> : card.layers.map((layer) => (
            <LayerRowView
              key={layer.id}
              layer={layer}
              onVisible={(v) => onLayerVisible(layer.id, v)}
              onOpacity={(o) => onLayerOpacity(layer.id, o)}
            />
          ))}
          {card.canWrite && (
            <div className="my-map-actions">
              <Button size="sm" onClick={onUpload}>Tải tệp lên vào bản đồ này</Button>
              <Button size="sm" onClick={onRename}>Đổi tên</Button>
              <Button size="sm" variant="danger" onClick={onDelete}>Xoá bản đồ</Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
