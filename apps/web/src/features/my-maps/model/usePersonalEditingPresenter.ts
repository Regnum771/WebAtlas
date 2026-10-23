import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, LAYER_GEOMETRY, type EditableLayerKey, type OgcGeometryType,
} from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { showToast } from '../../../shared/ui/toast.store';
import { useMapEditing, type GeoJSONGeometry } from '../../map/model/mapEditing';
import { closeTool, getShell, useShell } from '../../shell/model/shell.store';
import type { SaveFn, SaveResult } from '../../feature-editing/model/useAttributeFormPresenter';
import type { SaveWarning } from '../../feature-editing/api/features.api';
import * as api from '../api/workspace.api';
import type { FieldDef, GeometryType, LayerSummary } from '../api/workspace.api';
import { expandMap, forgetMap, setLayerVisible, setPersonalEditing } from './myMaps.store';
import { PERSONAL_READ_LIMIT, personalFeature, refreshPersonalLayer } from './personalLayers';
import { MapGoneError, useMapDetail, useMapWrite } from './queries';
import { closeTable, getTableState, relocate, select, useTableStore } from './table.store';

/** drawing: Vẽ thêm, on the map; form: a feature (the selected row, or a new drawing) is open. */
export type PersonalEditStep = 'drawing' | 'form';

type Extent = [number, number, number, number];

/** The table's selected feature, as useTablePresenter hands it over. */
export interface TableSelection {
  layer: LayerSummary;
  id: string;
  /** null until known: its row is on a page not read yet, and the map does not hold it either. */
  properties: Record<string, unknown> | null;
  /** The row's EPSG:4326 box, when its row is on the page. */
  bbox: Extent | null;
}

/** The feature open in the form: a new drawing (featureId null) or a stored one. */
interface Target {
  layer: LayerSummary;
  featureId: string | null;
  properties: Record<string, unknown>;
  /** null until known: a stored feature's shape is looked up when Sửa hình needs it. */
  geometry: GeoJSONGeometry | null;
  /** A new drawing always saves its geometry; a stored feature only once its shape moved. */
  geometryChanged: boolean;
}

/** What the edit-copy form (useAttributeFormPresenter) needs. */
export interface EditCopyFormData {
  layerKey: EditableLayerKey;
  attributes: string[];
  featureId: string | undefined;
  initialValues: Record<string, string>;
}

const FREE_DRAW_TYPE: Record<GeometryType, OgcGeometryType> = {
  point: 'Point',
  line: 'MultiLineString',
  polygon: 'MultiPolygon',
};
const SHAPE_WORD: Record<OgcGeometryType, string> = { Point: 'điểm', MultiLineString: 'đường', MultiPolygon: 'vùng' };

function editableKey(layer: LayerSummary): EditableLayerKey | null {
  return layer.kind === 'edit_copy' && (EDITABLE_LAYER_KEYS as readonly string[]).includes(layer.layerKey ?? '')
    ? (layer.layerKey as EditableLayerKey)
    : null;
}

/** The geometry a layer draws, or null when nothing can be drawn into it (a mixed import, a raster). */
function drawTypeOf(layer: LayerSummary): OgcGeometryType | null {
  if (layer.kind === 'free') return layer.geometryType ? FREE_DRAW_TYPE[layer.geometryType] : null;
  const key = editableKey(layer);
  return key ? LAYER_GEOMETRY[key] : null;
}

/** Vẽ thêm can draw into this layer (not a mixed-geometry import, not a raster). */
export function canDrawInto(layer: LayerSummary): boolean {
  return drawTypeOf(layer) !== null;
}

/** A property value as an input shows it. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The fields of a free layer's form: its declared fields, or for a layer without any (an
 * imported one) the feature's own property keys, edited as text.
 */
function freeFieldsOf(target: Target | null): FieldDef[] {
  if (!target || target.layer.kind !== 'free') return [];
  if (target.layer.fields.length > 0) return target.layer.fields;
  return Object.keys(target.properties).map((name) => ({ name, type: 'text' as const }));
}

function freeValuesOf(target: Target): Record<string, string> {
  return Object.fromEntries(freeFieldsOf(target).map((f) => [f.name, asText(target.properties[f.name])]));
}

/**
 * The properties a free-layer save sends. A declared field is typed (a number as a number; an
 * emptied field is null on an edit and left out of a new feature). Without declared fields, a
 * value the user did not touch is sent back as it was, so an imported number stays a number.
 */
function freeProperties(target: Target, values: Record<string, string>): Record<string, unknown> {
  const isNew = target.featureId === null;
  const out: Record<string, unknown> = {};
  if (target.layer.fields.length === 0) {
    for (const [name, original] of Object.entries(target.properties)) {
      const text = values[name] ?? '';
      out[name] = text === asText(original) ? original : text === '' ? null : text;
    }
    return out;
  }
  for (const field of target.layer.fields) {
    const text = (values[field.name] ?? '').trim();
    if (text === '') {
      if (!isNew) out[field.name] = null;
      continue;
    }
    const n = Number(text);
    // A value that is not a number is sent as typed: the API answers with its own message.
    out[field.name] = field.type === 'number' && Number.isFinite(n) ? n : text;
  }
  return out;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Chưa lưu được. Thử lại.';
}

/** A row's box, widened a little so a point's empty box still finds the point. */
function around([w, s, e, n]: Extent): Extent {
  const pad = 1e-6;
  return [w - pad, s - pad, e + pad, n + pad];
}

const sameProperties = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Editing the features of the open personal-layer table: the selected row's form beside the
 * table (`selection`, from useTablePresenter), Vẽ thêm into the table's layer, Sửa hình and Xoá.
 * A recipient sees the same form read-only. Mounted with the table, so the table closing (its
 * map gone, its layer deleted, Đóng, signing out) unmounts it and cancels what it started.
 *
 * Drawing and reshaping hold the map's clicks (`personalEditing`). It never edits beside the
 * official Biên tập tool: drawing, reshaping or an owner's form opening closes that tool, and the
 * tool opening closes the form and cancels a drawing.
 *
 * Every write goes through useMapWrite (queued per map, with the revision of the last read; it
 * reads the map and its tables again). The layer on the map is then read again; features are never
 * patched in place. After a save the row stays selected (a new feature becomes the selection) and
 * the table locates it again, so a feature the filter now hides keeps its form, with the note.
 */
export function usePersonalEditingPresenter(selection: TableSelection | null = null) {
  const { map } = useMapContext();
  const { startDraw, cancelDraw, startModifyFeature, cancelModify } = useMapEditing();
  const { tool } = useShell();
  const { open } = useTableStore();
  const mapId = open?.mapId ?? null;
  const tableLayerId = open?.layerId ?? null;
  const detail = useMapDetail(mapId);
  // Until the map is read, nothing is offered for writing.
  const readOnly = detail.data?.role !== 'owner';
  const write = useMapWrite(mapId ?? '');

  /** The layer Vẽ thêm draws into, from the start of the drawing until it is saved or left. */
  const [drawLayer, setDrawLayer] = useState<LayerSummary | null>(null);
  const [target, setTargetState] = useState<Target | null>(null);
  /** Bumped each time a form opens afresh: an edit-copy form seeds its values once per key. */
  const [version, setVersion] = useState(0);
  const [reshaping, setReshaping] = useState(false);
  const [freeValues, setFreeValues] = useState<Record<string, string>>({});
  const [freeError, setFreeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read by callbacks that outlive a render (the draw and modify callbacks, effects, unmount).
  const live = useRef({ target, drawLayer, mapId, readOnly, selection, layers: detail.data?.layers ?? [] });
  live.current = { target, drawLayer, mapId, readOnly, selection, layers: detail.data?.layers ?? [] };
  /** Whether this presenter started the DrawController's drawing / the ModifyController: only then may it cancel them. */
  const owns = useRef({ draw: false, modify: false });
  /** What the last edit-copy save sent, for its onSaved. */
  const savedCopy = useRef<Target | null>(null);

  const stopMapTools = useCallback(() => {
    if (owns.current.draw) cancelDraw();
    if (owns.current.modify) cancelModify();
    owns.current = { draw: false, modify: false };
    setReshaping(false);
  }, [cancelDraw, cancelModify]);

  const openTarget = useCallback((next: Target | null) => {
    setTargetState(next);
    setVersion((v) => v + 1);
    setFreeValues(next ? freeValuesOf(next) : {});
    setFreeError(null);
    setReshaping(false);
    setConfirmOpen(false);
    setError(null);
  }, []);

  /** Only one editor at a time: the official Biên tập tool closes. */
  const closeOfficialTool = useCallback(() => {
    if (getShell().tool === 'edit') closeTool();
  }, []);

  /** Huỷ: a drawing is dropped, the open feature closes and the row is no longer selected. */
  const leave = useCallback(() => {
    stopMapTools();
    setDrawLayer(null);
    openTarget(null);
    select(null);
  }, [stopMapTools, openTarget]);

  /** Opens the form of a stored feature (the selected row), without any map click. */
  const openFeature = useCallback((layer: LayerSummary, featureId: string, properties: Record<string, unknown>) => {
    stopMapTools();
    setDrawLayer(null);
    if (!live.current.readOnly) closeOfficialTool();
    const shape = map ? personalFeature(map, layer.id, featureId)?.geometry ?? null : null;
    openTarget({ layer, featureId, properties, geometry: shape as GeoJSONGeometry | null, geometryChanged: false });
  }, [map, stopMapTools, closeOfficialTool, openTarget]);

  /** Vẽ thêm: draws a new feature into the table's layer; its form opens once the shape is drawn. */
  const startDrawInto = useCallback((layer: LayerSummary) => {
    const drawType = drawTypeOf(layer);
    const id = live.current.mapId;
    if (live.current.readOnly || !drawType || !id) return;
    stopMapTools();
    closeOfficialTool();
    openTarget(null);
    select(null);
    // The new feature is shown once saved, so its map and layer must be on.
    expandMap(id);
    setLayerVisible(layer.id, true);
    setDrawLayer(layer);
    owns.current.draw = true;
    startDraw(drawType, (geometry) => {
      openTarget({ layer, featureId: null, properties: {}, geometry, geometryChanged: true });
    });
  }, [startDraw, stopMapTools, closeOfficialTool, openTarget]);

  // The form follows the table's selection: a row opens once its properties are known, another
  // row replaces it, no selection closes it (a new drawing stays). The same row read again with
  // other values (after a save, or a change made elsewhere) shows them.
  const selectionKey = selection ? JSON.stringify([selection.layer.id, selection.id, selection.properties]) : null;
  useEffect(() => {
    const current = live.current.target;
    const sel = live.current.selection;
    if (!sel) {
      if (current && current.featureId !== null) {
        stopMapTools();
        openTarget(null);
      }
      return;
    }
    const same = current !== null && current.layer.id === sel.layer.id && current.featureId === sel.id;
    if (same) {
      if (sel.properties && !sameProperties(sel.properties, current.properties)) {
        stopMapTools();
        openTarget({ ...current, properties: sel.properties, geometryChanged: false });
      }
      return;
    }
    if (sel.properties) {
      openFeature(sel.layer, sel.id, sel.properties);
      return;
    }
    // Not read yet: nothing else stays open beside the new selection meanwhile.
    stopMapTools();
    setDrawLayer(null);
    openTarget(null);
  }, [selectionKey, stopMapTools, openTarget, openFeature]);

  // The table switched to another layer: a drawing or a form of the old one is left.
  useEffect(() => {
    const { target: t, drawLayer: d } = live.current;
    if ((t && t.layer.id !== tableLayerId) || (d && d.id !== tableLayerId)) leave();
  }, [tableLayerId, leave]);

  // Biên tập opening closes the table's editing (a recipient's read-only form is not editing).
  useEffect(() => {
    if (tool !== 'edit' || live.current.readOnly) return;
    if (live.current.target || live.current.drawLayer) leave();
  }, [tool, leave]);

  const holding = drawLayer !== null || reshaping;
  useEffect(() => { setPersonalEditing(holding); }, [holding]);
  // Unmount (the table closing, signing out): cancel what this presenter started and free the map's clicks.
  useEffect(() => () => {
    if (owns.current.draw) cancelDraw();
    if (owns.current.modify) cancelModify();
    setPersonalEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, with the map tools of the provider
  }, []);

  /**
   * Sửa hình: reshape a copy of the open feature; a new drawing's sketch gives way to the copy. A
   * stored feature's shape comes from its layer on the map, or is read around its row's box.
   */
  const reshape = useCallback(async () => {
    const current = live.current.target;
    const id = live.current.mapId;
    if (!current || !id || live.current.readOnly) return;
    let geometry = current.geometry;
    if (!geometry && current.featureId !== null) {
      const featureId = current.featureId;
      geometry = (map ? personalFeature(map, current.layer.id, featureId)?.geometry ?? null : null) as GeoJSONGeometry | null;
      const sel = live.current.selection;
      const bbox = sel && sel.id === featureId && sel.layer.id === current.layer.id ? sel.bbox : null;
      if (!geometry && bbox) {
        try {
          const res = await api.listFeatures(id, current.layer.id, { bbox: around(bbox), limit: PERSONAL_READ_LIMIT });
          geometry = (res.features.find((f) => f.id === featureId)?.geometry ?? null) as GeoJSONGeometry | null;
        } catch {
          return;
        }
        // The form moved on meanwhile.
        if (live.current.target !== current) return;
      }
    }
    if (!geometry) return;
    if (owns.current.draw) {
      cancelDraw();
      owns.current.draw = false;
    }
    closeOfficialTool();
    owns.current.modify = true;
    setReshaping(true);
    const shape = geometry;
    setTargetState((t) => (t ? { ...t, geometry: t.geometry ?? shape } : t));
    startModifyFeature({ geometry: shape }, (moved) => {
      setTargetState((t) => (t ? { ...t, geometry: moved, geometryChanged: true } : t));
    });
  }, [map, cancelDraw, closeOfficialTool, startModifyFeature]);

  /**
   * After a save: the layer is read again on the map, the form stays open on the stored feature,
   * the row stays selected (a new feature becomes the selection) and is located again.
   */
  const afterSave = useCallback((saved: Target) => {
    if (map) refreshPersonalLayer(map, saved.layer.id);
    stopMapTools();
    setDrawLayer(null);
    setTargetState(saved);
    if (saved.featureId === null) return;
    if (getTableState().selectedId === saved.featureId) relocate();
    else select(saved.featureId);
  }, [map, stopMapTools]);

  /** The map is gone (deleted, or unshared): drop it, say so, and close the table. */
  const gone = useCallback((id: string, e: MapGoneError) => {
    forgetMap(id, live.current.layers.map((l) => l.id));
    showToast({ tone: 'warning', title: e.message });
    stopMapTools();
    closeTable();
  }, [stopMapTools]);

  /** Saves the open feature with the given properties and geometry (null: keep the stored shape). */
  const saveTarget = useCallback(async (
    properties: Record<string, unknown>, geometry: GeoJSONGeometry | null,
  ): Promise<{ id: string | null; warnings: api.FeatureWarning[] | undefined }> => {
    const current = live.current.target;
    const id = live.current.mapId;
    if (!current || !id) return { id: null, warnings: undefined };
    const layerId = current.layer.id;
    const featureId = current.featureId;
    // The map's GeoJSON type is the looser one; what the editor emits is a plain GeoJSON geometry.
    const shape = (geometry ?? current.geometry) as api.GeoJsonGeometry;
    try {
      const result = await write.run((expectedRevision) => {
        if (featureId === null) {
          return api.addFeature(id, layerId, { geometry: shape, properties, expectedRevision });
        }
        return api.updateFeature(id, layerId, featureId, geometry
          ? { geometry: shape, properties, expectedRevision }
          : { properties, expectedRevision });
      });
      const savedId = result.feature?.id;
      return { id: savedId === undefined || savedId === null ? featureId : String(savedId), warnings: result.warnings };
    } catch (e) {
      if (e instanceof MapGoneError) gone(id, e);
      throw e;
    }
  }, [write, gone]);

  /** The open feature as stored after a save that sent these properties. */
  const savedTarget = (current: Target, featureId: string | null, properties: Record<string, unknown>): Target => ({
    ...current, featureId, properties: { ...current.properties, ...properties }, geometryChanged: false,
  });

  const geometryToSave = target?.geometryChanged ? target.geometry : null;

  const setFreeValue = useCallback((name: string, value: string) => {
    setFreeValues((v) => ({ ...v, [name]: value }));
  }, []);

  /** Lưu on a free layer's form. A failure keeps what was typed, so the user can retry. */
  const submitFree = useCallback(async () => {
    const current = live.current.target;
    if (!current || saving || live.current.readOnly) return;
    setSaving(true);
    setFreeError(null);
    const properties = freeProperties(current, freeValues);
    try {
      const saved = await saveTarget(properties, current.geometryChanged ? current.geometry : null);
      setSaving(false);
      afterSave(savedTarget(current, saved.id, properties));
    } catch (e) {
      setSaving(false);
      if (!(e instanceof MapGoneError)) setFreeError(messageOf(e));
    }
  }, [saving, saveTarget, freeValues, afterSave]);

  /** The `save` of the edit-copy form (useAttributeFormPresenter): the workspace route, never /api/layers. */
  const saveEditCopy = useCallback<SaveFn>(async (properties, geometry): Promise<SaveResult> => {
    const current = live.current.target;
    const saved = await saveTarget(properties, geometry);
    if (current) savedCopy.current = savedTarget(current, saved.id, properties);
    return { warnings: saved.warnings as SaveWarning[] | undefined };
  }, [saveTarget]);

  /** The edit-copy form's onSaved. */
  const onSaved = useCallback(() => {
    const saved = savedCopy.current;
    savedCopy.current = null;
    if (saved) afterSave(saved);
  }, [afterSave]);

  const editCopy = useMemo<EditCopyFormData | null>(() => {
    const key = target ? editableKey(target.layer) : null;
    if (!target || !key) return null;
    const attributes = Object.keys(LAYER_ATTRIBUTE_MAP[key].attributes);
    return {
      layerKey: key,
      attributes,
      featureId: target.featureId ?? undefined,
      initialValues: Object.fromEntries(attributes.map((c) => [c, asText(target.properties[c])])),
    };
  }, [target]);

  const requestDelete = useCallback(() => {
    if (live.current.readOnly) return;
    setError(null);
    setConfirmOpen(true);
  }, []);
  const cancelDelete = useCallback(() => setConfirmOpen(false), []);
  /** Xoá: after the delete the selection clears; the table reads its page again. */
  const confirmDelete = useCallback(async () => {
    const current = live.current.target;
    const id = live.current.mapId;
    if (!current || current.featureId === null || !id || live.current.readOnly) return;
    const featureId = current.featureId;
    setDeleting(true);
    setError(null);
    try {
      await write.run((expectedRevision) => api.removeFeature(id, current.layer.id, featureId, expectedRevision));
      setDeleting(false);
      if (map) refreshPersonalLayer(map, current.layer.id);
      leave();
    } catch (e) {
      setDeleting(false);
      setConfirmOpen(false);
      if (e instanceof MapGoneError) gone(id, e);
      else setError(e instanceof Error ? e.message : 'Chưa xoá được. Thử lại.');
    }
  }, [map, write, leave, gone]);

  const step: PersonalEditStep | null = target ? 'form' : drawLayer ? 'drawing' : null;
  const drawType = drawLayer ? drawTypeOf(drawLayer) : null;

  return {
    step,
    /** A recipient: the form is shown with its inputs disabled and no buttons. */
    readOnly,
    drawShape: drawType ? SHAPE_WORD[drawType] : null,
    /** The open feature's layer kind and whether it is new. */
    targetKind: target ? (target.layer.kind === 'free' ? 'free' as const : 'edit_copy' as const) : null,
    targetKey: target ? `${target.layer.id}:${target.featureId ?? 'new'}:${version}` : null,
    isNew: target?.featureId === null,
    reshaping,
    geometryToSave,
    openFeature,
    startDrawInto,
    reshape,
    leave,
    // A free layer's form
    freeFields: freeFieldsOf(target),
    freeValues,
    setFreeValue,
    freeError,
    saving,
    submitFree,
    // An edit copy's form
    editCopy,
    saveEditCopy,
    onSaved,
    // Deleting
    confirmOpen,
    deleting,
    error,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
