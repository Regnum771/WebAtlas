import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../../shared/ui/Button';
import { Spinner } from '../../../shared/ui/Spinner';
import type { MapCardData } from '../model/useMyMapsPanelPresenter';
import { CardMenuView, type CardMenuItem } from './CardMenu.view';
import { LayerRowView } from './LayerRow.view';

interface Props {
  card: MapCardData;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onUpload: () => void;
  onExport: () => void;
  onShare: () => void;
  onCopy: () => void;
  onLayerVisible: (layerId: string, visible: boolean) => void;
  onLayerOpacity: (layerId: string, opacity: number) => void;
  onAddLayer: (kind: 'drawn' | 'edit_copy') => void;
  onLayerSettings: (layerId: string) => void;
  /** Opens a layer's table (and expands the map). */
  onLayerTable: (layerId: string) => void;
}

/**
 * A map in the list. The header holds the title, the layer count and the ⋯ menu (the map-level
 * actions); expanded, the card shows its layers and, for the owner, Tải tệp lên and Thêm lớp.
 */
export function MapCardView({ card, onToggle, onRename, onDelete, onUpload, onExport, onShare, onCopy, onLayerVisible, onLayerOpacity, onAddLayer, onLayerSettings, onLayerTable }: Props) {
  const [adding, setAdding] = useState(false);
  const Chevron = card.expanded ? ChevronDown : ChevronRight;
  // The owner and the people it is shared with may all download.
  const menu: CardMenuItem[] = card.canWrite
    ? [
      { label: 'Tải xuống', onSelect: onExport },
      { label: 'Chia sẻ', onSelect: onShare },
      { label: 'Đổi tên', onSelect: onRename },
      { label: 'Xoá bản đồ', onSelect: onDelete, danger: true },
    ]
    : [
      { label: 'Tải xuống', onSelect: onExport },
      card.copying
        ? { label: 'Đang sao chép…', onSelect: onCopy, disabled: true }
        : { label: 'Tạo bản sao', onSelect: onCopy },
    ];
  return (
    <li className="my-map-card">
      <div className="my-map-top">
        <button type="button" className="my-map-head" aria-expanded={card.expanded} onClick={onToggle}>
          <Chevron size={16} aria-hidden="true" />
          <span className="my-map-title">{card.title}</span>
        </button>
        {card.copying && <Spinner label="Đang sao chép" />}
        <CardMenuView items={menu} />
      </div>
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
              onSettings={card.canWrite ? () => onLayerSettings(layer.id) : undefined}
              onTable={layer.kind === 'raster' ? undefined : () => onLayerTable(layer.id)}
            />
          ))}
          {card.canWrite && (
            <div className="my-map-actions">
              <Button size="sm" onClick={onUpload}>Tải tệp lên</Button>
              <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>Thêm lớp</Button>
            </div>
          )}
          {card.canWrite && adding && (
            <div className="my-map-actions">
              <Button size="sm" onClick={() => { setAdding(false); onAddLayer('drawn'); }}>Lớp vẽ mới</Button>
              <Button size="sm" onClick={() => { setAdding(false); onAddLayer('edit_copy'); }}>Sửa một lớp chính thức</Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
