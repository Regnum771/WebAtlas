import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import { useMapContext } from '../../../app/providers/MapProvider';
import { MapModel } from '../model/MapModel';

const MapView: React.FC = () => {
  const el = useRef<HTMLDivElement>(null);
  const modelRef = useRef<MapModel | null>(null);
  const { setMap, basemap, layersState, reservoirFilter } = useMapContext();

  useEffect(() => {
    if (!el.current) return;
    const model = new MapModel();
    model.init(el.current);
    modelRef.current = model;
    setMap(model.getMap());
    return () => model.dispose();
  }, []);

  useEffect(() => { modelRef.current?.setBasemap(basemap); }, [basemap]);
  useEffect(() => { modelRef.current?.applyLayerStates(layersState); }, [layersState]);
  useEffect(() => { modelRef.current?.setReservoirFilter(reservoirFilter); }, [reservoirFilter]);

  return <div ref={el} className={`map-container basemap-${basemap}`} />;
};

export default MapView;
