import { useLayersPanel } from './model/useLayersPanel';
import { LayersPanelView } from './ui/LayersPanel.view';
import { useMapZoom } from '../map/model/useMapZoom';

export default function LayersPanel() {
  const zoom = useMapZoom();
  const { groups, missingDisplay, toggleLayerVisibility, setLayerOpacity } = useLayersPanel(zoom);
  return (
    <LayersPanelView
      groups={groups}
      missingDisplay={missingDisplay}
      onToggle={toggleLayerVisibility}
      onOpacity={setLayerOpacity}
    />
  );
}
