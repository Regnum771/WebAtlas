import { useState, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, denormalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { useMapEditing, type EditSelection, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { deleteFeature } from '../api/features.api';

interface SelectionVM {
  layerKey: EditableLayerKey;
  featureId: string;
  attributes: string[];
  initialValues: Record<string, string>;
}

export function useEditExistingPresenter() {
  const { enterEditMode, exitEditMode, startModify, cancelModify, clearSelection, refreshLayer } = useMapEditing();
  const [editMode, setEditMode] = useState(false);
  const [selection, setSelection] = useState<SelectionVM | null>(null);
  const [workingGeometry, setWorkingGeometry] = useState<GeoJSONGeometry | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    cancelModify();
    clearSelection();
    setSelection(null);
    setWorkingGeometry(null);
    setConfirmOpen(false);
    setError(null);
  }, [cancelModify, clearSelection]);

  const onSelected = useCallback((sel: EditSelection) => {
    const dbProps = denormalizeFeatureProperties(sel.layerKey, sel.isoProps);
    const attributes = Object.keys(LAYER_ATTRIBUTE_MAP[sel.layerKey].attributes);
    const initialValues: Record<string, string> = {};
    for (const col of attributes) {
      const v = dbProps[col];
      initialValues[col] = v == null ? '' : String(v);
    }
    setSelection({ layerKey: sel.layerKey, featureId: sel.featureId, attributes, initialValues });
    setWorkingGeometry(sel.geometry);
    startModify((g) => setWorkingGeometry(g));
  }, [startModify]);

  const enter = useCallback(() => {
    setEditMode(true);
    enterEditMode(onSelected);
  }, [enterEditMode, onSelected]);

  const exit = useCallback(() => {
    exitEditMode();
    setEditMode(false);
    reset();
  }, [exitEditMode, reset]);

  const onSaved = useCallback(() => {
    if (selection) refreshLayer(LAYER_ATTRIBUTE_MAP[selection.layerKey].layerStateId);
    reset();
  }, [selection, refreshLayer, reset]);

  const requestDelete = useCallback(() => setConfirmOpen(true), []);
  const cancelDelete = useCallback(() => setConfirmOpen(false), []);
  const confirmDelete = useCallback(async () => {
    if (!selection) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFeature(selection.layerKey, selection.featureId);
      refreshLayer(LAYER_ATTRIBUTE_MAP[selection.layerKey].layerStateId);
      reset();
    } catch {
      setError('Could not delete — please try again');
    } finally {
      setDeleting(false);
    }
  }, [selection, refreshLayer, reset]);

  return {
    editMode, selection, workingGeometry, confirmOpen, deleting, error,
    enter, exit, onSaved, requestDelete, cancelDelete, confirmDelete,
  };
}
