import { useFilterPresenter } from './model/useFilterPresenter';
import { FilterButtonView } from './ui/FilterButton.view';
import { FilterPanelView } from './ui/FilterPanel.view';
import { useMapContext } from '../../app/providers/MapProvider';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

// Filtering is a display tool available to every role. No auth gate (design §2).
export default function AttributeFilter() {
  const s = useFilterPresenter();
  const { layersState, toggleLayerVisibility } = useMapContext();

  // Enable = "make sure the layer is on", idempotent. `toggleLayerVisibility` FLIPS
  // visibility, so calling it on an already-visible layer would turn it OFF — the
  // not-loaded prompt can appear for a layer that is visible but still loading, so
  // only toggle when the layer is actually off.
  const onEnableLayer = () => {
    if (!s.layerKey) return;
    const stateId = LAYER_ATTRIBUTE_MAP[s.layerKey].layerStateId;
    const isVisible = layersState.find((l) => l.id === stateId)?.visible ?? false;
    if (!isVisible) toggleLayerVisibility(stateId);
  };

  return (
    <div className="attribute-filter">
      <FilterButtonView activeCount={s.activeCount} onToggle={s.isOpen ? s.close : s.open} />
      {s.isOpen && (
        <FilterPanelView
          layerKey={s.layerKey}
          fields={s.fields}
          conditions={s.conditions}
          results={s.results}
          count={s.count}
          shownCount={s.shownCount}
          unloadedLayers={s.unloadedLayers}
          error={s.error}
          onSelectLayer={s.setLayer}
          onAddCondition={s.addCondition}
          onUpdateCondition={s.updateCondition}
          onRemoveCondition={s.removeCondition}
          onClear={s.clear}
          onEnableLayer={onEnableLayer}
          onResultClick={s.onResultClick}
        />
      )}
    </div>
  );
}
