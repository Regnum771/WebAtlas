import { useState, useCallback } from 'react';
import type { EditableLayerKey, OgcGeometryType } from '@webatlas/shared';
import { useMapEditing, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { useLayerCatalog, type LayerCatalogEntry } from '../../../entities/layer/useLayerCatalog';

export type EditMode = 'idle' | 'drawing' | 'form';

export function useEditToolbarPresenter() {
  const { hasMap, startDraw, cancelDraw } = useMapEditing();
  const catalog = useLayerCatalog();
  const layers: LayerCatalogEntry[] = catalog.data ?? [];

  const [selectedKey, setSelectedKey] = useState<EditableLayerKey | null>(null);
  const [mode, setMode] = useState<EditMode>('idle');
  const [pendingGeometry, setPendingGeometry] = useState<GeoJSONGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = layers.find((l) => l.key === selectedKey) ?? null;
  const selectableGeomType: OgcGeometryType | null = selected?.geomType ?? null;

  const selectLayer = useCallback((key: EditableLayerKey) => {
    setSelectedKey(key);
    setMode('idle');
    setPendingGeometry(null);
    setError(null);
  }, []);

  const onGeometryFinished = useCallback((g: GeoJSONGeometry) => {
    setPendingGeometry(g);
    setMode('form');
  }, []);

  const startDrawing = useCallback(() => {
    if (!selected || !hasMap) { setError('Select a layer first'); return; }
    setError(null);
    setPendingGeometry(null);
    setMode('drawing');
    startDraw(selected.geomType, onGeometryFinished);
  }, [selected, hasMap, startDraw, onGeometryFinished]);

  const cancel = useCallback(() => {
    cancelDraw();
    setMode('idle');
    setPendingGeometry(null);
    setError(null);
  }, [cancelDraw]);

  return {
    layers, selectedKey, mode, pendingGeometry, selectableGeomType, error,
    selectLayer, startDrawing, cancel, onGeometryFinished,
  };
}
