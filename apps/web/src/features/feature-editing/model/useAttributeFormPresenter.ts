import { useState, useMemo, useCallback } from 'react';
import {
  attributeOf, labelFor, parseDisplay, toDisplayInput, unit, valueName,
  type DictAttribute, type EditableLayerKey,
} from '@webatlas/shared';
import { useDictionary } from '../../dictionary';
import { ApiError } from '../../../shared/api/apiClient';
import { refusalOf } from '../../../shared/api/refusal';
import { createFeature, updateFeature, type SaveWarning } from '../api/features.api';
import { showWarnings } from './saveWarnings';
import { useManagingUnitField } from './useManagingUnitField';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

/** What a `save` dependency answers: the API's save warnings, if any. */
export type SaveResult = { warnings?: SaveWarning[] } | void;

/**
 * Saves the form somewhere other than the official layer routes (a personal edit copy). It gets
 * the properties the official save would send and the geometry to save (null on an edit whose
 * shape did not move). An ApiError it throws is shown as the official one would be; any other
 * error's message is shown as it comes, so it must be written for the user.
 */
export type SaveFn = (properties: Record<string, unknown>, geometry: GeoJSONGeometry | null) => Promise<SaveResult>;

interface Args {
  layerKey: EditableLayerKey;
  attributes: string[]; // DB column names
  geometry: GeoJSONGeometry | null;
  onSaved: () => void;
  mode?: 'create' | 'edit';
  initialValues?: Record<string, string>;
  featureId?: string;
  /** Used instead of the official create/update when given. */
  save?: SaveFn;
  /** The managing unit picker offers the whole unit tree (useManagingUnitField). */
  anyUnit?: boolean;
}

export const MANAGING_UNIT_COLUMN = 'managing_unit';

export interface FieldOption { value: string; label: string }

/** How one attribute is entered: a number with its display unit, or a code picked from its values. */
export interface FieldInfo {
  /** The display unit's symbol, for a number attribute with a unit. */
  unitSymbol?: string;
  /** Every listed value of a code attribute, by name. */
  options?: FieldOption[];
}

/**
 * A code attribute's values in their declared order, without retired ones unless kept; a kept
 * code the dictionary lacks is offered as itself. Kept: the selected and the stored value, so a
 * change can always be undone.
 */
function codeOptions(attribute: DictAttribute, keep: string[]): FieldOption[] {
  const kept = keep.filter((c) => c !== '');
  const options = (attribute.values ?? [])
    .filter((v) => !v.retired || kept.includes(v.code))
    .sort((a, b) => a.order - b.order)
    .map((v) => ({ value: v.code, label: valueName(attribute, v.code) }));
  for (const code of kept) {
    if (!options.some((o) => o.value === code)) options.push({ value: code, label: code });
  }
  return options;
}

function fieldInfo(attribute: DictAttribute | undefined, keep: string[]): FieldInfo {
  if (!attribute) return {};
  if (attribute.valueType === 'code') return { options: codeOptions(attribute, keep) };
  if (attribute.valueType === 'number') {
    const code = attribute.displayUnit ?? attribute.storedUnit;
    // Unit 1 has an empty symbol: nothing to show.
    const symbol = code ? unit(code).symbol : '';
    return symbol ? { unitSymbol: symbol } : {};
  }
  return {};
}

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
  mode = 'create', initialValues, featureId, save, anyUnit,
}: Args) {
  const dictionary = useDictionary();
  /** The dictionary's attribute per column; the managing unit keeps its own field. */
  const dictAttributes = useMemo(() => {
    const out: Record<string, DictAttribute | undefined> = {};
    for (const col of attributes) {
      out[col] = col === MANAGING_UNIT_COLUMN ? undefined : attributeOf(dictionary, layerKey, col);
    }
    return out;
  }, [dictionary, layerKey, attributes]);

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const col of attributes) out[col] = labelFor(dictionary, layerKey, col);
    return out;
  }, [dictionary, layerKey, attributes]);

  // The text each input starts with: the stored value in the display unit at full precision.
  // Derived, not stored, so it follows the served dictionary once it loads.
  const seeded = useMemo(() => {
    const out: Record<string, string> = {};
    for (const col of attributes) {
      const stored = initialValues?.[col] ?? '';
      const attribute = dictAttributes[col];
      out[col] = attribute ? toDisplayInput(attribute, stored) : stored;
    }
    return out;
  }, [attributes, initialValues, dictAttributes]);

  /** Only what the user typed or picked; every other field shows its seeded text. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const col of attributes) out[col] = Object.hasOwn(edits, col) ? edits[col] : seeded[col];
    return out;
  }, [attributes, edits, seeded]);

  const fields = useMemo(() => {
    const out: Record<string, FieldInfo> = {};
    for (const col of attributes) out[col] = fieldInfo(dictAttributes[col], [values[col], initialValues?.[col] ?? '']);
    return out;
  }, [attributes, dictAttributes, values, initialValues]);

  const initialUnit = initialValues?.[MANAGING_UNIT_COLUMN] ?? '';
  const managingUnit = useManagingUnitField({ layerKey, mode, geometry, initial: initialUnit, anyUnit });
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
    setEdits((prev) => ({ ...prev, [col]: v }));
  }, []);

  const submit = useCallback(async () => {
    if (mode === 'create' && !geometry) { setError('Vẽ hình trước khi lưu.'); return; }
    if (managingUnit.locked) return;
    if (hasUnitField && managingUnit.error) return;
    const properties: Record<string, unknown> = {};
    const refusals: Record<string, string> = {};
    for (const col of attributes) {
      if (col === MANAGING_UNIT_COLUMN) continue;
      const text = values[col];
      // Untouched (its text is still the seeded one): the stored value goes back exactly as it
      // came, never re-read from the display text, so nothing the user did not touch is rounded.
      if (text === seeded[col]) {
        const stored = initialValues?.[col] ?? '';
        if (stored !== '') properties[col] = stored;
        continue;
      }
      if (text === '') continue;
      const attribute = dictAttributes[col];
      if (attribute?.valueType === 'number') {
        // Typed in the display unit; sent in the stored unit.
        const parsed = parseDisplay(attribute, text);
        if (parsed.ok) properties[col] = parsed.value;
        else refusals[col] = parsed.message;
      } else {
        properties[col] = text;
      }
    }
    if (Object.keys(refusals).length > 0) {
      setError(null);
      setErrorDetail(null);
      setFieldErrors(refusals);
      return;
    }
    setSaving(true);
    setError(null);
    setErrorDetail(null);
    setFieldErrors({});
    if (hasUnitField) {
      // Create: the field's unit when valid (else the API suggests one). Edit: only a change.
      const unit = managingUnit.submittable;
      if (unit && (mode === 'create' || unit !== initialUnit)) properties[MANAGING_UNIT_COLUMN] = unit;
    }
    try {
      if (save) {
        showWarnings((await save(properties, geometry))?.warnings);
      } else if (mode === 'edit') {
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
      } else if (save && e instanceof Error) {
        setError(e.message);
      } else {
        setError('Chưa lưu được. Thử lại.');
      }
    } finally {
      setSaving(false);
    }
  }, [mode, geometry, attributes, values, seeded, initialValues, dictAttributes, layerKey, featureId, onSaved, save,
    hasUnitField, managingUnit.error, managingUnit.locked, managingUnit.submittable, initialUnit]);

  return { values, labels, fields, setField, managingUnit, canSave, saving, error, errorDetail, fieldErrors, submit };
}
