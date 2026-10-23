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
import { forgetMap, setLayerVisible, setPersonalEditing, useMyMapsStore } from './myMaps.store';
import { personalFeatureAt, refreshPersonalLayer } from './personalLayers';
import { MapGoneError, useMapDetail, useMapWrite } from './queries';

export type PersonalEditKind = 'draw' | 'edit';
/** pick: choosing a layer (Vẽ thêm); drawing: on the map; select: waiting for a click (Sửa đối tượng); form: a feature is open. */
export type PersonalEditStep = 'pick' | 'drawing' | 'select' | 'form';

export interface DrawableLayer {
  id: string;
  title: string;
  /** What the DrawController draws: Point, LineString (for MultiLineString) or Polygon (for MultiPolygon). */
  drawType: OgcGeometryType;
}

/** The feature open in the form: a new drawing (featureId null) or a stored one. */
interface Target {
  layer: LayerSummary;
  featureId: string | null;
  properties: Record<string, unknown>;
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

interface Session { mapId: string; kind: PersonalEditKind }

/**
 * Drawing and editing features in the owner's personal maps (Vẽ thêm, Sửa đối tượng). One mode
 * at a time for the whole Bản của tôi section; while it is on, it holds the map's clicks
 * (`personalEditing`), and it never runs beside the official Biên tập tool: entering it closes
 * that tool, and opening the tool leaves it. Closing the map card, collapsing the section or
 * signing out (unmount) leaves it too, cancelling a drawing in progress.
 *
 * Every write goes through useMapWrite (queued per map, with the revision of the last read) and
 * is followed by a fresh read of the layer; features on the map are never patched in place.
 */
export function usePersonalEditingPresenter() {
  const { map } = useMapContext();
  const { startDraw, cancelDraw, startModifyFeature, cancelModify } = useMapEditing();
  const store = useMyMapsStore();
  const { tool } = useShell();

  const [session, setSession] = useState<Session | null>(null);
  const [drawLayerId, setDrawLayerId] = useState<string | null>(null);
  const [target, setTargetState] = useState<Target | null>(null);
  const [reshaping, setReshaping] = useState(false);
  const [freeValues, setFreeValues] = useState<Record<string, string>>({});
  const [freeError, setFreeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapId = session?.mapId ?? null;
  const detail = useMapDetail(mapId);
  const layers = useMemo(() => detail.data?.layers ?? [], [detail.data]);
  const write = useMapWrite(mapId ?? '');

  // Read by callbacks that outlive a render (the draw and modify callbacks, the click handler, unmount).
  const live = useRef({ session, target, layers });
  live.current = { session, target, layers };
  /** Whether this presenter started the DrawController's drawing / the ModifyController: only then may it cancel them. */
  const owns = useRef({ draw: false, modify: false });

  const stopMapTools = useCallback(() => {
    if (owns.current.draw) cancelDraw();
    if (owns.current.modify) cancelModify();
    owns.current = { draw: false, modify: false };
  }, [cancelDraw, cancelModify]);

  const openTarget = useCallback((next: Target | null) => {
    setTargetState(next);
    setFreeValues(next ? freeValuesOf(next) : {});
    setFreeError(null);
    setReshaping(false);
    setConfirmOpen(false);
    setError(null);
  }, []);

  const leave = useCallback(() => {
    stopMapTools();
    setSession(null);
    setDrawLayerId(null);
    openTarget(null);
  }, [stopMapTools, openTarget]);

  const enter = useCallback((next: Session) => {
    stopMapTools();
    // Only one editor holds the map's clicks.
    if (getShell().tool === 'edit') closeTool();
    setDrawLayerId(null);
    openTarget(null);
    setSession(next);
  }, [stopMapTools, openTarget]);

  const startDrawMode = useCallback((id: string) => enter({ mapId: id, kind: 'draw' }), [enter]);
  const startEditMode = useCallback((id: string) => enter({ mapId: id, kind: 'edit' }), [enter]);

  // Leave when the card closes, the section collapses or Biên tập opens.
  useEffect(() => {
    if (!session) return;
    if (store.collapsed || !store.expanded.has(session.mapId) || tool === 'edit') leave();
  }, [session, store.collapsed, store.expanded, tool, leave]);

  useEffect(() => { setPersonalEditing(session !== null); }, [session]);
  // Unmount (signing out): cancel what this presenter started and free the map's clicks.
  useEffect(() => () => {
    if (owns.current.draw) cancelDraw();
    if (owns.current.modify) cancelModify();
    setPersonalEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, with the map tools of the provider
  }, []);

  const drawable = useMemo<DrawableLayer[]>(() => layers
    .flatMap((l) => {
      const drawType = drawTypeOf(l);
      return drawType ? [{ id: l.id, title: l.title, drawType }] : [];
    }), [layers]);

  const pickLayer = useCallback((layerId: string) => {
    const layer = live.current.layers.find((l) => l.id === layerId);
    const drawType = layer ? drawTypeOf(layer) : null;
    if (!layer || !drawType) return;
    // The new feature is shown once saved, so the layer must be on.
    setLayerVisible(layerId, true);
    setDrawLayerId(layerId);
    owns.current.draw = true;
    startDraw(drawType, (geometry) => {
      openTarget({ layer, featureId: null, properties: {}, geometry, geometryChanged: true });
    });
  }, [startDraw, openTarget]);

  // Sửa đối tượng: a click on a feature of this map opens it in the form.
  useEffect(() => {
    if (!map || session?.kind !== 'edit') return;
    const sessionMap = session.mapId;
    const onClick = (e: { pixel: number[] }) => {
      const hit = personalFeatureAt(map, e.pixel, sessionMap);
      if (!hit || !hit.feature.geometry) return;
      const layer = live.current.layers.find((l) => l.id === hit.layerId);
      if (!layer || (layer.kind !== 'free' && !editableKey(layer))) return;
      const current = live.current.target;
      // A click on the feature already open (or its copy being reshaped) keeps the form as it is.
      if (current && current.layer.id === layer.id && current.featureId === hit.feature.id) return;
      if (owns.current.modify) {
        cancelModify();
        owns.current.modify = false;
      }
      openTarget({
        layer, featureId: hit.feature.id, properties: hit.feature.properties,
        geometry: hit.feature.geometry, geometryChanged: false,
      });
    };
    map.on('singleclick', onClick);
    return () => { map.un('singleclick', onClick); };
  }, [map, session, cancelModify, openTarget]);

  /** Sửa hình: reshape a copy of the open feature; a new drawing's sketch gives way to the copy. */
  const reshape = useCallback(() => {
    const current = live.current.target;
    if (!current?.geometry) return;
    if (owns.current.draw) {
      cancelDraw();
      owns.current.draw = false;
    }
    owns.current.modify = true;
    setReshaping(true);
    startModifyFeature({ geometry: current.geometry }, (geometry) => {
      setTargetState((t) => (t ? { ...t, geometry, geometryChanged: true } : t));
    });
  }, [cancelDraw, startModifyFeature]);

  /** After a write: read the layer again; a drawing ends the mode, an edit waits for the next click. */
  const afterWrite = useCallback((layerId: string) => {
    if (map) refreshPersonalLayer(map, layerId);
    stopMapTools();
    if (live.current.session?.kind === 'draw') leave();
    else openTarget(null);
  }, [map, stopMapTools, leave, openTarget]);

  /** The map is gone (deleted, or unshared): drop it, say so, and leave. */
  const gone = useCallback((id: string, e: MapGoneError) => {
    forgetMap(id, live.current.layers.map((l) => l.id));
    showToast({ tone: 'warning', title: e.message });
    leave();
  }, [leave]);

  /** Saves the open feature with the given properties and geometry (null: keep the stored shape). */
  const saveTarget = useCallback(async (
    properties: Record<string, unknown>, geometry: GeoJSONGeometry | null,
  ): Promise<api.FeatureWarning[] | undefined> => {
    const current = live.current.target;
    const id = live.current.session?.mapId;
    if (!current || !id) return undefined;
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
      return result.warnings;
    } catch (e) {
      if (e instanceof MapGoneError) gone(id, e);
      throw e;
    }
  }, [write, gone]);

  const geometryToSave = target?.geometryChanged ? target.geometry : null;

  const setFreeValue = useCallback((name: string, value: string) => {
    setFreeValues((v) => ({ ...v, [name]: value }));
  }, []);

  /** Lưu on a free layer's form. A failure keeps what was typed, so the user can retry. */
  const submitFree = useCallback(async () => {
    const current = live.current.target;
    if (!current || saving) return;
    setSaving(true);
    setFreeError(null);
    try {
      await saveTarget(freeProperties(current, freeValues), current.geometryChanged ? current.geometry : null);
      setSaving(false);
      afterWrite(current.layer.id);
    } catch (e) {
      setSaving(false);
      if (!(e instanceof MapGoneError)) setFreeError(messageOf(e));
    }
  }, [saving, saveTarget, freeValues, afterWrite]);

  /** The `save` of the edit-copy form (useAttributeFormPresenter): the workspace route, never /api/layers. */
  const saveEditCopy = useCallback<SaveFn>(async (properties, geometry): Promise<SaveResult> => {
    const warnings = await saveTarget(properties, geometry);
    return { warnings: warnings as SaveWarning[] | undefined };
  }, [saveTarget]);

  /** The edit-copy form's onSaved. */
  const onSaved = useCallback(() => {
    const current = live.current.target;
    if (current) afterWrite(current.layer.id);
  }, [afterWrite]);

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

  const requestDelete = useCallback(() => { setError(null); setConfirmOpen(true); }, []);
  const cancelDelete = useCallback(() => setConfirmOpen(false), []);
  const confirmDelete = useCallback(async () => {
    const current = live.current.target;
    const id = live.current.session?.mapId;
    if (!current || current.featureId === null || !id) return;
    const featureId = current.featureId;
    setDeleting(true);
    setError(null);
    try {
      await write.run((expectedRevision) => api.removeFeature(id, current.layer.id, featureId, expectedRevision));
      setDeleting(false);
      afterWrite(current.layer.id);
    } catch (e) {
      setDeleting(false);
      setConfirmOpen(false);
      if (e instanceof MapGoneError) gone(id, e);
      else setError(e instanceof Error ? e.message : 'Chưa xoá được. Thử lại.');
    }
  }, [write, afterWrite, gone]);

  const step: PersonalEditStep | null = !session
    ? null
    : target
      ? 'form'
      : session.kind === 'edit'
        ? 'select'
        : drawLayerId
          ? 'drawing'
          : 'pick';
  const drawLayer = drawable.find((l) => l.id === drawLayerId);

  return {
    mapId,
    kind: session?.kind ?? null,
    step,
    /** The session map's layers, as last read. */
    layers,
    drawable,
    drawShape: drawLayer ? SHAPE_WORD[drawLayer.drawType] : null,
    /** The open feature's layer kind and whether it is new. */
    targetKind: target ? (target.layer.kind === 'free' ? 'free' as const : 'edit_copy' as const) : null,
    targetKey: target ? `${target.layer.id}:${target.featureId ?? 'new'}` : null,
    isNew: target?.featureId === null,
    reshaping,
    geometryToSave,
    startDrawMode,
    startEditMode,
    pickLayer,
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
