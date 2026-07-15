import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import type { OgcGeometryType, EditableLayerKey } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { DrawController } from './DrawController';
import { SelectController, type EditSelection } from './SelectController';
import { ModifyController } from './ModifyController';
import { LAYER_REGISTRY } from '../../../entities/layer/layerRegistry';
import type { GeoJSONGeometry } from './geo';

export type { GeoJSONGeometry };
export type { EditSelection };

interface MapEditingValue {
  hasMap: boolean;
  startDraw: (geomType: OgcGeometryType, onFinish: (g: GeoJSONGeometry) => void) => void;
  cancelDraw: () => void;
  refreshLayer: (layerStateId: string) => void;
  registerRefresh: (fn: (layerStateId: string) => void) => void;
  editing: boolean;
  enterEditMode: (onSelected: (sel: EditSelection) => void) => void;
  exitEditMode: () => void;
  startModify: (onChange: (g: GeoJSONGeometry) => void) => void;
  cancelModify: () => void;
  clearSelection: () => void;
}

const MapEditingContext = createContext<MapEditingValue | undefined>(undefined);

export function MapEditingProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext();
  const controllerRef = useRef<DrawController | null>(null);
  const selectRef = useRef<SelectController | null>(null);
  const modifyRef = useRef<ModifyController | null>(null);
  const refreshRef = useRef<((id: string) => void) | null>(null);
  const [hasMap, setHasMap] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (map && !controllerRef.current) {
      controllerRef.current = new DrawController(map);
      const layerKeyByStateId: Record<string, EditableLayerKey> = {};
      for (const e of LAYER_REGISTRY) layerKeyByStateId[e.layerStateId] = e.layerKey;
      selectRef.current = new SelectController(map, layerKeyByStateId);
      modifyRef.current = new ModifyController(map);
      setHasMap(true);
    }
    return () => {
      controllerRef.current?.dispose();
      selectRef.current?.dispose();
      modifyRef.current?.dispose();
      controllerRef.current = null;
      selectRef.current = null;
      modifyRef.current = null;
    };
  }, [map]);

  const startDraw = useCallback((geomType: OgcGeometryType, onFinish: (g: GeoJSONGeometry) => void) => {
    controllerRef.current?.startDraw(geomType, onFinish);
  }, []);
  const cancelDraw = useCallback(() => { controllerRef.current?.cancel(); }, []);
  const refreshLayer = useCallback((id: string) => { refreshRef.current?.(id); }, []);
  const registerRefresh = useCallback((fn: (id: string) => void) => { refreshRef.current = fn; }, []);

  const enterEditMode = useCallback((onSelected: (sel: EditSelection) => void) => {
    selectRef.current?.activate(onSelected);
    setEditing(true);
  }, []);
  const exitEditMode = useCallback(() => {
    modifyRef.current?.cancel();
    selectRef.current?.deactivate();
    setEditing(false);
  }, []);
  const startModify = useCallback((onChange: (g: GeoJSONGeometry) => void) => {
    const f = selectRef.current?.getSelectedFeature();
    if (f) modifyRef.current?.start(f, onChange);
  }, []);
  const cancelModify = useCallback(() => { modifyRef.current?.cancel(); }, []);
  const clearSelection = useCallback(() => { selectRef.current?.clear(); }, []);

  return (
    <MapEditingContext.Provider value={{
      hasMap, startDraw, cancelDraw, refreshLayer, registerRefresh,
      editing, enterEditMode, exitEditMode, startModify, cancelModify, clearSelection,
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
