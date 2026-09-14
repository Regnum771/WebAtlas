import type { PanelGroup } from '../model/useLayersPanel';

interface Props {
  groups: PanelGroup[];
  /** layerStateIds the API catalog knows about but LAYER_DISPLAY does not cover. */
  missingDisplay: string[];
  onToggle: (layerStateId: string) => void;
  onOpacity: (layerStateId: string, opacity: number) => void;
}

/** Passive: renders grouped layer rows. No data fetching, no map access. */
export function LayersPanelView({ groups, missingDisplay, onToggle, onOpacity }: Props) {
  return (
    <div className="layers-panel">
      <h2 className="panel-title">Quản lý dữ liệu</h2>
      {missingDisplay.length > 0 && (
        <p role="status" className="layers-warning">
          {missingDisplay.length} lớp có trong hệ thống nhưng chưa có mô tả hiển thị:{' '}
          {missingDisplay.join(', ')}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.name} className="layers-group">
          <h3 className="layers-group-title">{group.name}</h3>
          {group.layers.map((layer) => (
            <div key={layer.id} className={`layer-row ${layer.gated ? 'gated' : ''}`}>
              <label className="layer-label">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => onToggle(layer.id)}
                />
                <span>{layer.name}</span>
              </label>
              {layer.gated && <span className="layer-gate-hint">{layer.gateHint}</span>}
              {layer.visible && !layer.gated && (
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={layer.opacity}
                  aria-label={`Độ mờ ${layer.name}`}
                  onChange={(e) => onOpacity(layer.id, parseFloat(e.target.value))}
                />
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
