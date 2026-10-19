import { useState, useMemo, useCallback } from 'react';
import { LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { refusalOf } from '../../../shared/api/refusal';
import { createFeature, updateFeature } from '../api/features.api';
import { showWarnings } from './saveWarnings';
import { useManagingUnitField } from './useManagingUnitField';
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

export const MANAGING_UNIT_COLUMN = 'managing_unit';

function messageFor(e: ApiError): { error: string | null; fieldErrors: Record<string, string> } {
  const refusal = refusalOf(e);
  if (refusal) return { error: refusal.message, fieldErrors: {} };
  if (e.status === 422) return { error: 'Hình vẽ không hợp lệ. Vẽ lại.', fieldErrors: {} };
  if (e.code === 'STALE_EDIT') return { error: 'Lớp này vừa được người khác thay đổi. Thử lưu lại.', fieldErrors: {} };
  if (e.status === 409) return { error: 'Đã có đối tượng như thế này.', fieldErrors: {} };
  if (e.status === 404) return { error: 'Đối tượng này không còn nữa.', fieldErrors: {} };
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
  const initialUnit = initialValues?.[MANAGING_UNIT_COLUMN] ?? '';
  const managingUnit = useManagingUnitField({ layerKey, mode, geometry, initial: initialUnit });
  const hasUnitField = attributes.includes(MANAGING_UNIT_COLUMN);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A second line under `error`: the missing review right of a refusal (refusalOf). */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Edit: a feature whose current unit fails update AND review cannot be saved at all (the
  // field shows it as "ngoài phạm vi"); the API would refuse it anyway.
  const canSave = (mode === 'edit' || geometry !== null) && !saving && !managingUnit.locked
    && !(hasUnitField && managingUnit.error);

  const setField = useCallback((col: string, v: string) => {
    setValues((prev) => ({ ...prev, [col]: v }));
  }, []);

  const submit = useCallback(async () => {
    if (mode === 'create' && !geometry) { setError('Vẽ hình trước khi lưu.'); return; }
    if (managingUnit.locked) return;
    if (hasUnitField && managingUnit.error) return;
    setSaving(true);
    setError(null);
    setErrorDetail(null);
    setFieldErrors({});
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) if (v !== '' && k !== MANAGING_UNIT_COLUMN) properties[k] = v;
    if (hasUnitField) {
      // Create: the field's unit when valid (else the API suggests one). Edit: only a change.
      const unit = managingUnit.submittable;
      if (unit && (mode === 'create' || unit !== initialUnit)) properties[MANAGING_UNIT_COLUMN] = unit;
    }
    try {
      if (mode === 'edit') {
        // featureId is guaranteed non-null in edit mode: the container only renders the edit form for a real selection.
        // No geometry key unless there is one to save: the API then keeps the stored shape.
        showWarnings((await updateFeature(layerKey, featureId!, geometry ? { geometry, properties } : { properties }))?.warnings);
      } else {
        showWarnings((await createFeature(layerKey, { geometry: geometry!, properties }))?.warnings);
      }
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        const mapped = messageFor(e);
        setError(mapped.error);
        setErrorDetail(refusalOf(e)?.detail ?? null);
        setFieldErrors(mapped.fieldErrors);
      } else {
        setError('Chưa lưu được. Thử lại.');
      }
    } finally {
      setSaving(false);
    }
  }, [mode, geometry, values, layerKey, featureId, onSaved, hasUnitField, managingUnit.error, managingUnit.locked, managingUnit.submittable, initialUnit]);

  return { values, labels, setField, managingUnit, canSave, saving, error, errorDetail, fieldErrors, submit };
}
