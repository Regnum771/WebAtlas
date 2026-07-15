import { useState, useMemo, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { createFeature, updateFeature } from '../api/features.api';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

interface Args {
  layerKey: EditableLayerKey;
  attributes: string[]; // DB column names
  geometry: GeoJSONGeometry | null;
  onSaved: () => void;
  mode?: 'create' | 'edit';
  initialValues?: Record<string, string>;
  featureId?: string;
}

function messageFor(e: ApiError): { error: string | null; fieldErrors: Record<string, string> } {
  if (e.status === 422) return { error: 'Invalid geometry — please redraw', fieldErrors: {} };
  if (e.status === 409) return { error: 'A feature like this already exists', fieldErrors: {} };
  if (e.status === 404) return { error: 'This feature no longer exists', fieldErrors: {} };
  if (e.status === 400) {
    const details = e.details as { formErrors?: unknown; fieldErrors?: unknown } | null | undefined;
    const rawFieldErrors = details?.fieldErrors;
    if (rawFieldErrors && typeof rawFieldErrors === 'object' && !Array.isArray(rawFieldErrors)) {
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawFieldErrors as Record<string, unknown>)) {
        if (Array.isArray(v)) fe[k] = v.join(', ');
      }
      if (Object.keys(fe).length > 0) return { error: null, fieldErrors: fe };
    }
    const formErrors = details?.formErrors;
    if (Array.isArray(formErrors) && formErrors.length > 0) {
      return { error: (formErrors as string[]).join(', '), fieldErrors: {} };
    }
    return { error: e.message, fieldErrors: {} };
  }
  return { error: e.message, fieldErrors: {} };
}

export function useAttributeFormPresenter({
  layerKey, attributes, geometry, onSaved,
  mode = 'create', initialValues, featureId,
}: Args) {
  const labels = useMemo(() => {
    const map = LAYER_ATTRIBUTE_MAP[layerKey].attributes;
    const out: Record<string, string> = {};
    for (const col of attributes) out[col] = map[col] ?? col;
    return out;
  }, [layerKey, attributes]);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(attributes.map((c) => [c, initialValues?.[c] ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canSave = (mode === 'edit' || geometry !== null) && !saving;

  const setField = useCallback((col: string, v: string) => {
    setValues((prev) => ({ ...prev, [col]: v }));
  }, []);

  const submit = useCallback(async () => {
    if (mode === 'create' && !geometry) { setError('Draw a geometry first'); return; }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '') properties[k] = v;
    try {
      if (mode === 'edit') {
        await updateFeature(layerKey, featureId!, { geometry: geometry ?? undefined, properties });
      } else {
        await createFeature(layerKey, { geometry: geometry!, properties });
      }
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
  }, [mode, geometry, values, layerKey, featureId, onSaved]);

  return { values, labels, setField, canSave, saving, error, fieldErrors, submit };
}
