import type { DictAttribute, DictFeatureType } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

/** One attribute as a single layer serves it: the entry plus the revision the next edit must quote. */
export type RevisedAttribute = DictAttribute & { revision: number };
export type RevisedFeatureType = Omit<DictFeatureType, 'attributes'> & { revision: number; attributes: RevisedAttribute[] };

export type HistoryReason = 'edit' | 'restore' | 'sync_revert' | 'sync_retire';

export interface HistoryEntry {
  id: number;
  featureType: string;
  attribute: string | null;
  code: string | null;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: HistoryReason;
  /** Null for the sync, or once the author's account is deleted. */
  changedBy: { id: string; name: string } | null;
  changedAt: string;
}

const json = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) });
const layerPath = (layer: string) => `/api/dictionary/${encodeURIComponent(layer)}`;

/** The per-layer GET: the only one that carries revisions. */
export function fetchLayerEntry(layer: string): Promise<RevisedFeatureType> {
  return apiRequest<RevisedFeatureType>(layerPath(layer));
}

/**
 * Newest first. Layer only: every row of the layer, attributes included. With `attribute`: that
 * attribute's rows alone, so a busy layer cannot push them out of the limit.
 */
export function fetchHistory(layer: string, attribute: string | null, limit = 200): Promise<HistoryEntry[]> {
  const scope = attribute === null ? '' : `&attribute=${encodeURIComponent(attribute)}`;
  return apiRequest<HistoryEntry[]>(`/api/dictionary/history?layer=${encodeURIComponent(layer)}${scope}&limit=${limit}`);
}

export function patchLayer(layer: string, body: Record<string, unknown>): Promise<RevisedFeatureType> {
  return apiRequest<RevisedFeatureType>(layerPath(layer), json(body));
}

export function patchAttribute(layer: string, attribute: string, body: Record<string, unknown>): Promise<RevisedAttribute> {
  return apiRequest<RevisedAttribute>(`${layerPath(layer)}/${encodeURIComponent(attribute)}`, json(body));
}

/** Puts fields back to the current code default; `attribute` null restores feature-type fields. */
export function restoreFields(layer: string, attribute: string | null, fields: string[]): Promise<RevisedFeatureType | RevisedAttribute> {
  const path = attribute === null ? `${layerPath(layer)}/restore` : `${layerPath(layer)}/${encodeURIComponent(attribute)}/restore`;
  return apiRequest(path, { method: 'POST', body: JSON.stringify({ fields }) });
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const attributePath = (layer: string, attribute: string) => `${layerPath(layer)}/${encodeURIComponent(attribute)}`;

/** Adds a code to an open list. `expectedRevision` is the PARENT attribute's revision. */
export function addValue(
  layer: string, attribute: string, body: { expectedRevision: number; code: string; name: string; definition?: string },
): Promise<RevisedAttribute> {
  return apiRequest<RevisedAttribute>(`${attributePath(layer, attribute)}/values`, post(body));
}

/** Edits one listed value; a null `colorHint` clears the colour. Bumps the parent attribute's revision. */
export function patchValue(
  layer: string, attribute: string, code: string,
  body: { expectedRevision: number; name?: string; definition?: string; colorHint?: string | null; retired?: boolean },
): Promise<RevisedAttribute> {
  return apiRequest<RevisedAttribute>(`${attributePath(layer, attribute)}/values/${encodeURIComponent(code)}`, json(body));
}

export interface StoredUnitPreviewRow {
  id: string;
  stored: unknown;
  /** The value formatted under the current stored unit. */
  before: string;
  /** The value formatted under the proposed stored unit. */
  after: string;
}

/** Up to five real values before and after a stored-unit correction. May be empty (raster band, no data). */
export function previewStoredUnit(layer: string, attribute: string, storedUnit: string): Promise<{ rows: StoredUnitPreviewRow[] }> {
  return apiRequest(`${attributePath(layer, attribute)}/stored-unit/preview`, post({ storedUnit }));
}
