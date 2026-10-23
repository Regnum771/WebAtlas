import type { LayerRowData } from '../model/useMyMapsPanelPresenter';

interface Props {
  layer: LayerRowData;
  onVisible: (visible: boolean) => void;
  onOpacity: (opacity: number) => void;
}

/**
 * One personal layer: a checkbox with its title, its kind, an opacity slider while visible, and
 * a note when the last viewport read was cut short.
 */
export function LayerRowView({ layer, onVisible, onOpacity }: Props) {
  return (
    <div className="layer-row my-maps-layer">
      <label className="layer-label">
        <input type="checkbox" checked={layer.visible} onChange={(e) => onVisible(e.target.checked)} />
        <span>{layer.title}</span>
      </label>
      <span className="layer-gate-hint">{layer.kindLabel}</span>
      {layer.visible && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={layer.opacity}
          aria-label={`Độ mờ ${layer.title}`}
          onChange={(e) => onOpacity(parseFloat(e.target.value))}
        />
      )}
      {layer.visible && layer.truncated !== null && (
        <p className="my-maps-truncated">
          {`Chỉ hiện ${layer.truncated} đối tượng đầu trong khung nhìn; phóng to để xem đủ.`}
        </p>
      )}
    </div>
  );
}
