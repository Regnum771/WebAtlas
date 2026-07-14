import { useState, useMemo, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { createFeature } from '../api/features.api';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

interface Args {
  layerKey: EditableLayerKey;
  attributes: string[]; // DB column names
  geometry: GeoJSONGeometry | null;
  onSaved: () => void;
}

function messageFor(e: ApiError): { error: string | null; fieldErrors: Record<string, string> } {
  if (e.status === 422) return { error: 'Invalid geometry — please redraw', fieldErrors: {} };
  if (e.status === 409) return { error: 'A feature like this already exists', fieldErrors: {} };
  if (e.status === 400) {
    const details = e.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(details as Record<string, unknown>)) fe[k] = String(v);
      if (Object.keys(fe).length > 0) return { error: null, fieldErrors: fe };
    }
    return { error: e.message, fieldErrors: {} };
  }
  return { error: e.message, fieldErrors: {} };
}

export function useAttributeFormPresenter({ layerKey, attributes, geometry, onSaved }: Args) {
  const labels = useMemo(() => {
    const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
    const out: Record<string, string> = {};
    for (const col of attributes) out[col] = map[col] ?? col;
    return out;
  }, [layerKey, attributes]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(attributes.map((c) => [c, '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canSave = geometry !== null && !saving;

  const setField = useCallback((col: string, v: string) => {
    setValues((prev) => ({ ...prev, [col]: v }));
  }, []);

  const submit = useCallback(async () => {
    if (!geometry) { setError('Draw a geometry first'); return; }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '') properties[k] = v;
    try {
      await createFeature(layerKey, { geometry, properties });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        const mapped = messageFor(e);
        setError(mapped.error);
        setFieldErrors(mapped.fieldErrors);
      } else {
        setError('Something went wrong');
      }
    } finally {
      setSaving(false);
    }
  }, [geometry, values, layerKey, onSaved]);

  return { values, labels, setField, canSave, saving, error, fieldErrors, submit };
}
