import { useState, useCallback, useEffect, useRef } from 'react';
import { LAYER_ATTRIBUTE_MAP, denormalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { useMapEditing, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { useSelection } from '../../../entities/selection';
import { olGeometryTo4326GeoJSON } from '../../map/model/geo';
import { deleteFeature } from '../api/features.api';

interface SelectionVM {
  layerKey: EditableLayerKey;
  featureId: string;
  attributes: string[];
  initialValues: Record<string, string>;
}

/**
 * Editing SUBSCRIBES to the shared selection; it no longer owns an interaction of its
 * own. Selecting a feature is read-only — geometry becomes modifiable only when the
 * user presses the pen (beginEdit), so browsing results can never nudge a geometry.
 */
export function useEditExistingPresenter() {
  const { startModify, cancelModify, refreshLayer } = useMapEditing();
  const { selection: mapSelection } = useSelection();
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<SelectionVM | null>(null);
  const [workingGeometry, setWorkingGeometry] = useState<GeoJSONGeometry | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    cancelModify();
    setEditing(false);
    setSelection(null);
    setWorkingGeometry(null);
    setConfirmOpen(false);
    setError(null);
  }, [cancelModify]);

  // reset() is not stable across renders of the mapEditing context (cancelModify's
  // identity can change), so route it through a ref to keep the watcher effect below
  // from re-subscribing every render — it should only fire when the SELECTION changes.
  const resetRef = useRef(reset);
  resetRef.current = reset;

  // Edit mode is only valid for the feature it was opened on. If the shared selection
  // moves to a different feature (or is cleared) while editing, the Modify/Translate
  // interactions must be torn down immediately — geometry must never stay draggable
  // once its editable surface has disappeared from the panel.
  useEffect(() => {
    if (!editing) return;
    if (!selection) return;
    const stillEditingSameFeature =
      mapSelection != null &&
      mapSelection.layerKey === selection.layerKey &&
      mapSelection.featureId === selection.featureId;
    if (!stillEditingSameFeature) resetRef.current();
  }, [mapSelection, editing, selection]);

  // The pen. Promotes the current read-only selection into an editable one.
  const beginEdit = useCallback(() => {
    if (!mapSelection) return;
    const geom = mapSelection.feature.getGeometry();
    if (!geom) return; // refuse to edit a feature whose geometry could not be read
    const dbProps = denormalizeFeatureProperties(mapSelection.layerKey, mapSelection.isoProps);
    const attributes = Object.keys(LAYER_ATTRIBUTE_MAP[mapSelection.layerKey].attributes);
    const initialValues: Record<string, string> = {};
    for (const col of attributes) {
      const v = dbProps[col];
      initialValues[col] = v == null ? '' : String(v);
    }
    setSelection({
      layerKey: mapSelection.layerKey,
      featureId: mapSelection.featureId,
      attributes,
      initialValues,
    });
    setWorkingGeometry(olGeometryTo4326GeoJSON(geom));
    setEditing(true);
    startModify((g) => setWorkingGeometry(g));
  }, [mapSelection, startModify]);

  // Leaves edit mode but keeps the feature selected and highlighted.
  const cancelEdit = useCallback(() => { reset(); }, [reset]);

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
    editing, selection, workingGeometry, confirmOpen, deleting, error,
    beginEdit, cancelEdit, onSaved, requestDelete, cancelDelete, confirmDelete,
  };
}
