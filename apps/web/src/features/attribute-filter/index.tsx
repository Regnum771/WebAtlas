import { useFilterPresenter } from './model/useFilterPresenter';
import { FilterButtonView } from './ui/FilterButton.view';
import { FilterPanelView } from './ui/FilterPanel.view';
import { useMapContext } from '../../app/providers/MapProvider';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

// Filtering is a display tool available to every role. No auth gate (design §2).
export default function AttributeFilter() {
  const s = useFilterPresenter();
  const { toggleLayerVisibility } = useMapContext();

  const onEnableLayer = () => {
    if (s.layerKey) toggleLayerVisibility(LAYER_ATTRIBUTE_MAP[s.layerKey].layerStateId);
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
          layerLoaded={s.layerLoaded}
          onSelectLayer={s.setLayer}
          onAddCondition={s.addCondition}
          onUpdateCondition={s.updateCondition}
          onRemoveCondition={s.removeCondition}
          onClear={s.clear}
          onEnableLayer={onEnableLayer}
          onResultClick={s.flyTo}
        />
      )}
    </div>
  );
}
