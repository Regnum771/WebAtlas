import { useState, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, denormalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { useMapEditing, type EditSelection, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { ApiError } from '../../../shared/api/apiClient';
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
  /**
   * True once Modify/Translate actually changed the selected geometry. The editor's starting
   * geometry may be SIMPLIFIED: a river or lake selected from the vector tiles is loaded from
   * GET /api/features/:layerKey/:id/geometry, the search-highlight endpoint, which simplifies.
   * Saving it back unchanged would overwrite the stored shape with that copy, so the geometry
   * is sent on update only when the user moved it (geometryToSave); otherwise only the
   * attributes are saved and the API keeps the stored geometry.
   */
  const [geometryChanged, setGeometryChanged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    cancelModify();
    clearSelection();
    setSelection(null);
    setWorkingGeometry(null);
    setGeometryChanged(false);
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
    setGeometryChanged(false);
    startModify((g) => {
      setWorkingGeometry(g);
      setGeometryChanged(true);
    });
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
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'STALE_EDIT'
        ? 'Someone else changed this layer while you were saving. Please try again.'
        : 'Could not delete — please try again');
    } finally {
      setDeleting(false);
    }
  }, [selection, refreshLayer, reset]);

  return {
    editMode, selection, workingGeometry, confirmOpen, deleting, error,
    geometryToSave: geometryChanged ? workingGeometry : null,
    enter, exit, onSaved, requestDelete, cancelDelete, confirmDelete,
  };
}
