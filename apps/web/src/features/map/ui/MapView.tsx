import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapEditing } from '../model/mapEditing';
import { MapModel } from '../model/MapModel';

export interface MapViewProps {
  /** Is the rail flyout (layers/legend) currently open? Docked, not overlaid —
   *  see main.css .map-container — so the map's own box shrinks and OpenLayers
   *  must be told (MapModel#updateSize) once the CSS inset transition settles. */
  flyoutOpen: boolean;
}

const MapView: React.FC<MapViewProps> = ({ flyoutOpen }) => {
  const el = useRef<HTMLDivElement>(null);
  const modelRef = useRef<MapModel | null>(null);
  const { setMap, basemap, layersState, reservoirFilter } = useMapContext();
  const { registerRefresh, registerSetSelectActive } = useMapEditing();

  useEffect(() => {
    if (!el.current) return;
    const model = new MapModel();
    model.init(el.current);
    modelRef.current = model;
    setMap(model.getMap());
    registerRefresh((id: string) => model.refreshLayer(id));
    registerSetSelectActive((active: boolean) => model.setSelectActive(active));
    return () => model.dispose();
  }, []);

  useEffect(() => { modelRef.current?.setBasemap(basemap); }, [basemap]);
  useEffect(() => { modelRef.current?.applyLayerStates(layersState); }, [layersState]);
  useEffect(() => { modelRef.current?.setReservoirFilter(reservoirFilter); }, [reservoirFilter]);

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
    <div ref={el} className={`map-container basemap-${basemap}${flyoutOpen ? ' flyout-open' : ''}`} />
  );
};

export default MapView;
