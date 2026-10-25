import { useLayersPanel } from './model/useLayersPanel';
import { LayersPanelView } from './ui/LayersPanel.view';
import { useDictionarySheetPresenter } from '../dictionary/model/useDictionarySheetPresenter';
import { DictionarySheetView } from '../dictionary/ui/DictionarySheet.view';
import { useMapZoom } from '../map/model/useMapZoom';
import { useMapContext } from '../../app/providers/MapProvider';

export default function LayersPanel() {
  const zoom = useMapZoom();
  const { groups, missingDisplay, toggleLayerVisibility, setLayerOpacity } = useLayersPanel(zoom);
  const { contourSettings, setContourSettings } = useMapContext();
  const { sheet, openSheet, close } = useDictionarySheetPresenter();
  return (
    <>
    <LayersPanelView
      groups={groups}
      missingDisplay={missingDisplay}
      onToggle={toggleLayerVisibility}
      onOpacity={setLayerOpacity}
      contourSettings={contourSettings}
      onContourSettings={setContourSettings}
      onInfo={openSheet}
    />
    {sheet && <DictionarySheetView {...sheet} onClose={close} />}
    </>
  );
}
