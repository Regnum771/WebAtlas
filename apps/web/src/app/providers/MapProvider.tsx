import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { Map } from 'ol';
import type { BasemapType, ReservoirFilterType, LayerState } from '../../features/map/model/MapModel';
import { LAYER_DISPLAY } from '../../entities/layer/layerDisplay';

export type { BasemapType, ReservoirFilterType, LayerState };

interface MapContextType {
  map: Map | null;
  setMap: (map: Map | null) => void;
  basemap: BasemapType;
  setBasemap: (basemap: BasemapType) => void;
  layersState: LayerState[];
  toggleLayerVisibility: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  reservoirFilter: ReservoirFilterType;
  setReservoirFilter: (filter: ReservoirFilterType) => void;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export const MapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [map, setMap] = useState<Map | null>(null);
  const [basemap, setBasemap] = useState<BasemapType>('street');
  const [reservoirFilter, setReservoirFilter] = useState<ReservoirFilterType>('all');
  
  // Initialize layers state from LAYER_DISPLAY (presentation metadata for the layers panel)
  const initialLayersState: LayerState[] = Object.entries(LAYER_DISPLAY).map(([id, meta]) => ({
    id,
    visible: meta.defaultVisible,
    opacity: meta.opacity
  }));

  const [layersState, setLayersState] = useState<LayerState[]>(initialLayersState);

  const toggleLayerVisibility = (layerId: string) => {
    setLayersState(prev => prev.map(layer => 
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
    ));
  };

  const setLayerOpacity = (layerId: string, opacity: number) => {
    setLayersState(prev => prev.map(layer => 
      layer.id === layerId ? { ...layer, opacity } : layer
    ));
  };

  return (
    <MapContext.Provider value={{
      map, setMap,
      basemap, setBasemap,
      layersState, toggleLayerVisibility, setLayerOpacity,
      reservoirFilter, setReservoirFilter
    }}>
      {children}
    </MapContext.Provider>
  );
};

export const useMapContext = () => {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error('useMapContext must be used within a MapProvider');
  }
  return context;
};
