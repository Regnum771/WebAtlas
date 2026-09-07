import { useEffect, useState } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { MIN_ZOOM } from './zoomScale';

/** Current map zoom, updated continuously during interaction. */
export function useMapZoom(): number {
  const { map } = useMapContext();
  const [zoom, setZoom] = useState<number>(MIN_ZOOM);

  useEffect(() => {
    if (!map) return;
    const view = map.getView();
    setZoom(view.getZoom() ?? MIN_ZOOM);
    const onChange = () => {
      const z = view.getZoom();
      if (z !== undefined) setZoom(z);
    };
    view.on('change:resolution', onChange);
    return () => view.un('change:resolution', onChange);
  }, [map]);

  return zoom;
}
