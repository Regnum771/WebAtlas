import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapEditing } from '../model/mapEditing';
import { MapModel } from '../model/MapModel';
import { formatCoordinate } from '../model/crs';
import { useCrsPreference } from '../model/crsPreference';
import CursorElevation from './CursorElevation';
import CrsSelect from './CrsSelect';

export interface MapViewProps {
  /** Is the rail flyout (layers/legend) currently open? Docked, not overlaid —
   *  see main.css .map-container — so the map's own box shrinks and OpenLayers
   *  must be told (MapModel#updateSize) once the CSS inset transition settles. */
  flyoutOpen: boolean;
}

const MapView: React.FC<MapViewProps> = ({ flyoutOpen }) => {
  const el = useRef<HTMLDivElement>(null);
  const modelRef = useRef<MapModel | null>(null);
  const { setMap, setBusy, basemap, layersState, reservoirFilter, contourSettings } = useMapContext();
  const { registerRefresh, registerSetSelectActive } = useMapEditing();

  useEffect(() => {
    if (!el.current) return;
    const model = new MapModel();
    model.init(el.current);
    modelRef.current = model;
    setMap(model.getMap());
    model.setLoadingListener(setBusy);
    registerRefresh((id: string) => model.refreshLayer(id));
    registerSetSelectActive((active: boolean) => model.setSelectActive(active));
    return () => model.dispose();
  }, []);

  useEffect(() => { modelRef.current?.setBasemap(basemap); }, [basemap]);
  useEffect(() => { modelRef.current?.applyLayerStates(layersState); }, [layersState]);
  useEffect(() => { modelRef.current?.setReservoirFilter(reservoirFilter); }, [reservoirFilter]);
  useEffect(() => { modelRef.current?.setContourSettings(contourSettings); }, [contourSettings]);

  const [crsId] = useCrsPreference();
  useEffect(() => {
    modelRef.current?.setCoordinateFormat((c) => formatCoordinate(c, crsId));
  }, [crsId]);

  // The CSS transition on .map-container's left/width (main.css) means the
  // container's box only reaches its final size once the transition ends —
  // reading it any earlier gives OpenLayers the mid-transition size. Cover
  // both cases: `transitionend` for the normal animated case, and an
  // immediate call on every flyoutOpen change for environments where the
  // transition is instant/disabled (e.g. prefers-reduced-motion) and no
  // transitionend fires at all. Calling updateSize() twice is harmless.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onTransitionEnd = (e: Event) => {
      if (e.target !== node) return;
      modelRef.current?.updateSize();
    };
    node.addEventListener('transitionend', onTransitionEnd);
    return () => node.removeEventListener('transitionend', onTransitionEnd);
  }, []);

  useEffect(() => {
    modelRef.current?.updateSize();
  }, [flyoutOpen]);

  return (
    // CursorElevation nằm BÊN TRONG hộp bản đồ vì nó định vị tuyệt đối theo hộp đó, cạnh
    // ô toạ độ mà OpenLayers vẽ. OL chèn .ol-viewport của nó vào cùng phần tử này và
    // không xoá các con sẵn có, nên hai bên sống chung được.
    <div ref={el} className={`map-container basemap-${basemap}${flyoutOpen ? ' flyout-open' : ''}`}>
      <CursorElevation />
      <CrsSelect />
    </div>
  );
};

export default MapView;
