import { useCallback } from 'react';
import { useAssistant } from './model/useAssistant';
import { AssistantPanelView } from './ui/AssistantPanel.view';
import { createCommandExecutor } from '../map/model/mapCommands';
import { buildMapContext } from '../map/model/mapContext';
import { useMapContext as useMapProvider } from '../../app/providers/MapProvider';

export default function Assistant() {
  const { map, basemap, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } =
    useMapProvider();

  const run = createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
    layerExists: (id) => layersState.some((l) => l.id === id),
  });

  // Read at send time, not render time: the user may pan between typing and
  // sending, and the context that matters is the one at the moment they ask.
  const getMapContext = useCallback(
    () => buildMapContext({ map, basemap, layersState }),
    [map, basemap, layersState]
  );

  const { turns, loading, error, send, retry } = useAssistant({ getMapContext, run });

  return (
    <AssistantPanelView
      turns={turns}
      loading={loading}
      error={error}
      onSend={send}
      onRetry={retry}
    />
  );
}
