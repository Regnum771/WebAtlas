import React, { useEffect, useRef } from 'react';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useMapEditing } from '../model/mapEditing';
import { MapModel } from '../model/MapModel';
import { formatCoordinate } from '../model/crs';
import { useCrsPreference } from '../model/crsPreference';
import { useReadoutTargets } from '../model/readoutTargets';

const MapView: React.FC = () => {
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

  // The coordinate readout and the scale line live in the status bar (StatusBar.tsx).
  const readouts = useReadoutTargets();
  useEffect(() => {
    modelRef.current?.setReadoutTargets(readouts);
  }, [readouts]);

  // OpenLayers caches the viewport size and does not watch its container, so
  // tell it whenever the container's own box changes (panel, dock or window
  // resize). Where ResizeObserver does not exist, fall back to window resize.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const update = () => modelRef.current?.updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div ref={el} className={`map-container basemap-${basemap}`} />;
};

export default MapView;
