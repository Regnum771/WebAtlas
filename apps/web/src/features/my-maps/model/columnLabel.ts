import { attributeOf, labelFor, type DictAttribute, type Dictionary } from '@webatlas/shared';
import type { LayerSummary } from '../api/workspace.api';

/**
 * The official layer whose dictionary entry describes this layer's columns: an edit copy's
 * layer key. Free and imported layers have none; their columns stay as they are named.
 */
function dictionaryKey(layer: LayerSummary): string | null {
  return layer.kind === 'edit_copy' && layer.layerKey ? layer.layerKey : null;
}

/** The dictionary attribute of a column of an edit copy; undefined for any other layer or column. */
export function columnAttribute(layer: LayerSummary, column: string, dictionary: Dictionary): DictAttribute | undefined {
  const key = dictionaryKey(layer);
  return key ? attributeOf(dictionary, key, column) : undefined;
}

/**
 * The label of a layer's column in the table's header and the condition field pickers: the
 * dictionary's label for an edit copy's column, the column's own name otherwise.
 */
export function columnLabel(layer: LayerSummary, column: string, dictionary: Dictionary): string {
  const key = dictionaryKey(layer);
  return key ? labelFor(dictionary, key, column) : column;
}
