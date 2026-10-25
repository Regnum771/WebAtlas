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
