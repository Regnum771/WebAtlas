import type { LayerRowData } from '../model/useMyMapsPanelPresenter';

interface Props {
  layer: LayerRowData;
  onVisible: (visible: boolean) => void;
  onOpacity: (opacity: number) => void;
}

/** One personal layer: a checkbox with its title, its kind, and an opacity slider while visible. */
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
    </div>
  );
}
