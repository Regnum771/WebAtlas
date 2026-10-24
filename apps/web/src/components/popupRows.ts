import { attributeOf, formatValue, labelFor, LAYER_ATTRIBUTE_MAP, type Dictionary, type EditableLayerKey } from '@webatlas/shared';

/** The popup reads ISO-normalised properties: map a DB column to the property that carries it. */
function propertyOf(layerKey: EditableLayerKey, column: string): string {
  return LAYER_ATTRIBUTE_MAP[layerKey].attributes[column] ?? column;
}

/** True when the feature carries a value for the column (null and undefined are "missing"). */
export function popupHas(layerKey: EditableLayerKey, column: string, props: Record<string, unknown>): boolean {
  const v = props[propertyOf(layerKey, column)];
  return v !== null && v !== undefined && v !== '';
}

/** Dictionary label of a column. */
export function popupLabel(dictionary: Dictionary, layerKey: EditableLayerKey, column: string): string {
  return labelFor(dictionary, layerKey, column);
}

/** Display text of a column's value: display unit, vi-VN number format, code name; the raw value without an entry. */
export function popupValue(
  dictionary: Dictionary,
  layerKey: EditableLayerKey,
  column: string,
  props: Record<string, unknown>,
): string {
  const stored = props[propertyOf(layerKey, column)];
  const attribute = attributeOf(dictionary, layerKey, column);
  if (!attribute) return stored === null || stored === undefined ? '—' : String(stored);
  return formatValue(attribute, stored);
}
