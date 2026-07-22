import { EDITABLE_LAYER_KEYS, type EditableLayerKey, type FilterField } from '@webatlas/shared';
import type { Condition } from '../model/applyFilter';
import type { FilterResult } from '../model/useFilterPresenter';
import { LAYER_LABELS } from '../model/layerLabels';
import { ConditionRowView } from './ConditionRow.view';

// Re-export so existing importers of LAYER_LABELS from this module keep working.
export { LAYER_LABELS };

export function FilterPanelView(props: {
  layerKey: EditableLayerKey | null;
  fields: FilterField[];
  conditions: Condition[];
  results: FilterResult[];
  count: number;
  shownCount: number;
  unloadedLayers: EditableLayerKey[];
  error: string | null;
  onSelectLayer: (key: EditableLayerKey) => void;
  onAddCondition: () => void;
  onUpdateCondition: (i: number, patch: Partial<Condition>) => void;
  onRemoveCondition: (i: number) => void;
  onClear: () => void;
  onEnableLayer: () => void;
  onResultClick: (id: string) => void;
}) {
  const {
    layerKey, fields, conditions, results, count, shownCount, unloadedLayers, error,
    onSelectLayer, onAddCondition, onUpdateCondition, onRemoveCondition, onClear, onEnableLayer, onResultClick,
  } = props;

  const layerUnloaded = !!layerKey && unloadedLayers.includes(layerKey);

  return (
    <div className="filter-panel glass-panel" aria-label="Bộ lọc dữ liệu">
      <label className="filter-layer-label">
        Lớp
        <select
          className="filter-layer-select"
          value={layerKey ?? ''}
          onChange={(e) => onSelectLayer(e.target.value as EditableLayerKey)}
          aria-label="Lớp dữ liệu"
        >
          <option value="" disabled>Chọn lớp…</option>
          {EDITABLE_LAYER_KEYS.map((k) => (
            <option key={k} value={k}>{LAYER_LABELS[k]}</option>
          ))}
        </select>
      </label>

      {layerKey && layerUnloaded && (
        <div className="filter-empty">
          <p>Lớp chưa được tải.</p>
          <button type="button" onClick={onEnableLayer}>Bật lớp để lọc</button>
        </div>
      )}

      {layerKey && !layerUnloaded && (
        <>
          <div className="filter-conditions">
            {conditions.map((c, i) => (
              <ConditionRowView
                key={i}
                condition={c}
                fields={fields}
                onChange={(patch) => onUpdateCondition(i, patch)}
                onRemove={() => onRemoveCondition(i)}
              />
            ))}
            <button type="button" className="filter-add" onClick={onAddCondition}>+ thêm điều kiện</button>
          </div>

          <div className="filter-results-header">
            <span>
              {error ? null : shownCount < count ? `hiển thị ${shownCount} / ${count}` : `${count} kết quả`}
            </span>
            <button type="button" className="filter-clear" onClick={onClear}>Xóa lọc</button>
          </div>

          {error ? (
            <div className="filter-empty">
              <p>{error}</p>
            </div>
          ) : (
            <div className="filter-results">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="filter-result-item"
                  onClick={() => onResultClick(r.id)}
                  disabled={!r.hasGeometry}
                >
                  <span className="filter-result-name">{r.label}</span>
                  {r.layerLabel && <span className="filter-result-sub">{r.layerLabel}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
