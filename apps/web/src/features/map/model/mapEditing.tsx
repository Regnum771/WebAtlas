import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import type { OgcGeometryType } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { DrawController } from './DrawController';
import { ModifyController } from './ModifyController';
import { useSelection } from '../../../entities/selection';
import type { GeoJSONGeometry } from './geo';

export type { GeoJSONGeometry };

interface MapEditingValue {
  hasMap: boolean;
  startDraw: (geomType: OgcGeometryType, onFinish: (g: GeoJSONGeometry) => void) => void;
  cancelDraw: () => void;
  refreshLayer: (layerStateId: string) => void;
  registerRefresh: (fn: (layerStateId: string) => void) => void;
  startModify: (onChange: (g: GeoJSONGeometry) => void) => void;
  cancelModify: () => void;
}

const MapEditingContext = createContext<MapEditingValue | undefined>(undefined);

export function MapEditingProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext();
  const { selection } = useSelection();
  const controllerRef = useRef<DrawController | null>(null);
  const modifyRef = useRef<ModifyController | null>(null);
  const refreshRef = useRef<((id: string) => void) | null>(null);
  const [hasMap, setHasMap] = useState(false);

  useEffect(() => {
    if (map && !controllerRef.current) {
      controllerRef.current = new DrawController(map);
      modifyRef.current = new ModifyController(map);
      setHasMap(true);
    }
    return () => {
      controllerRef.current?.dispose();
      modifyRef.current?.dispose();
      controllerRef.current = null;
      modifyRef.current = null;
    };
  }, [map]);

  const startDraw = useCallback((geomType: OgcGeometryType, onFinish: (g: GeoJSONGeometry) => void) => {
    controllerRef.current?.startDraw(geomType, onFinish);
  }, []);
  const cancelDraw = useCallback(() => { controllerRef.current?.cancel(); }, []);
  const refreshLayer = useCallback((id: string) => { refreshRef.current?.(id); }, []);
  const registerRefresh = useCallback((fn: (id: string) => void) => { refreshRef.current = fn; }, []);

  const startModify = useCallback((onChange: (g: GeoJSONGeometry) => void) => {
    const f = selection?.feature;
    if (f) modifyRef.current?.start(f, onChange);
  }, [selection]);
  const cancelModify = useCallback(() => { modifyRef.current?.cancel(); }, []);

  return (
    <MapEditingContext.Provider value={{
      hasMap, startDraw, cancelDraw, refreshLayer, registerRefresh,
      startModify, cancelModify,
    }}>
      {children}
    </MapEditingContext.Provider>
  );
}

export function useMapEditing(): MapEditingValue {
  const ctx = useContext(MapEditingContext);
  if (!ctx) throw new Error('useMapEditing must be used within a MapEditingProvider');
  return ctx;
}
