import { CONTOUR_INTERVALS, TERRAIN_LAYER_STATE_IDS, type ContourInterval } from '@webatlas/shared';
import type { PanelGroup } from '../model/useLayersPanel';
import type { ContourSettings } from '../../map/model/contours';

const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;

/** Type guard narrowing a raw <select> value against the shipped interval set,
 *  rather than casting Number(e.target.value) straight to ContourInterval. */
function isContourInterval(value: number): value is ContourInterval {
  return (CONTOUR_INTERVALS as readonly number[]).includes(value);
}

interface Props {
  groups: PanelGroup[];
  /** layerStateIds the API catalog knows about but LAYER_DISPLAY does not cover. */
  missingDisplay: string[];
  onToggle: (layerStateId: string) => void;
  onOpacity: (layerStateId: string, opacity: number) => void;
  contourSettings: ContourSettings;
  onContourSettings: (next: ContourSettings) => void;
}

/** Passive: renders grouped layer rows. No data fetching, no map access. */
export function LayersPanelView({
  groups,
  missingDisplay,
  onToggle,
  onOpacity,
  contourSettings,
  onContourSettings,
}: Props) {
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
              {layer.id === CONTOURS && layer.visible && (
                <div className="layer-suboptions">
                  <label>
                    <span>Khoảng cao đều</span>
                    <select
                      aria-label="Khoảng cao đều"
                      value={String(contourSettings.interval)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === 'auto') {
                          onContourSettings({ ...contourSettings, interval: 'auto' });
                          return;
                        }
                        const parsed = Number(raw);
                        if (isContourInterval(parsed)) {
                          onContourSettings({ ...contourSettings, interval: parsed });
                        }
                      }}
                    >
                      <option value="auto">Tự động theo mức thu phóng</option>
                      {CONTOUR_INTERVALS.map((m) => (
                        <option key={m} value={m}>{m} m</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="Nhãn độ cao"
                      checked={contourSettings.labels}
                      onChange={(e) => onContourSettings({ ...contourSettings, labels: e.target.checked })}
                    />
                    <span>Nhãn độ cao</span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
