import { useMemo } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { createCommandExecutor } from './mapCommands';

/** The command executor wired to the live map, in one place for every component
 *  that issues map commands (the basemap tool, the ROI components, analysis). */
export function useMapCommands() {
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();
  return useMemo(
    () =>
      createCommandExecutor({
        map, setBasemap, toggleLayerVisibility, setLayerOpacity,
        getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
        layerExists: (id) => layersState.some((l) => l.id === id),
      }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState]
  );
}
