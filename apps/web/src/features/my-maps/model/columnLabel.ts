import type { LayerSummary } from '../api/workspace.api';

/**
 * The label of a layer's column in the table's header and the condition field pickers. For now
 * the column's own name; this is the one place the data dictionary will give official columns
 * their Vietnamese labels (spec T8).
 */
export function columnLabel(_layer: LayerSummary, column: string): string {
  return column;
}
