import type { Map as OlMap } from 'ol';
import { EDITABLE_LAYER_KEYS, LAYER_ATTRIBUTE_MAP, type EditableLayerKey } from '@webatlas/shared';
import { applyFilter, type Condition, type FeatureLike } from './applyFilter';
import { LAYER_LABELS } from './layerLabels';
import { parseFeatureId } from '../../../entities/selection/model/selection';

export const DEFAULT_RESULT_CAP = 20;

/**
 * Shown when the user opens the filter but has built no condition yet. An explicit
 * message beats both alternatives: a silent empty list reads as "no matches found",
 * and returning every feature dumps thousands of rows nobody asked for.
 */
export const EMPTY_FILTER_MESSAGE = 'Chưa có điều kiện lọc';

export interface Query {
  /** 'all' searches every thematic layer; an array scopes to those layers. */
  layers: EditableLayerKey[] | 'all';
  conditions: Condition[];
}

export interface QueryHit {
  layerKey: EditableLayerKey;
  layerLabel: string;
  /** The feature's real identity, NOT its index — an index cannot survive a source reload. */
  featureId: string;
  label: string;
  feature: FeatureLike;
}

export interface LayerQueryResult {
  hits: QueryHit[];
  /** Total matches before the display cap, so the UI can show "20 / N". */
  total: number;
  /** Queried layers with nothing loaded — surfaced so empty != "does not exist". */
  unloadedLayers: EditableLayerKey[];
  /**
   * Why there is nothing to show, when the reason is not "no matches" — currently only
   * the empty filter. null on a real query, including one that legitimately matched 0.
   */
  error: string | null;
}

interface IdFeature extends FeatureLike {
  getId?(): string | number | undefined;
}

function readFeatures(map: OlMap, layerKey: EditableLayerKey): IdFeature[] | null {
  const stateId = LAYER_ATTRIBUTE_MAP[layerKey].layerStateId;
  const layer = map.getLayers().getArray()
    .find((l: { get(k: string): unknown }) => l.get('id') === stateId) as
    | { getSource(): { getFeatures(): IdFeature[] } | null }
    | undefined;
  const src = layer?.getSource?.();
  if (!src) return null;
  return src.getFeatures();
}

/**
 * The one query path behind BOTH surfaces: the drawer filter (one layer, N conditions)
 * and the top-bar search (all layers, one name condition). Runs over features already
 * loaded in the browser, so results reflect what the map has — layers that contributed
 * nothing because they are not loaded come back in `unloadedLayers` rather than being
 * silently dropped.
 */
export function runQuery(
  map: OlMap | null,
  query: Query,
  cap: number = DEFAULT_RESULT_CAP,
): LayerQueryResult {
  // No map yet is a transient startup state, not something to explain to the user.
  if (!map) return { hits: [], total: 0, unloadedLayers: [], error: null };
  // An empty filter is refused explicitly rather than returning [] (reads as "no
  // matches") or every feature (dumps thousands of rows).
  if (query.conditions.length === 0) {
    return { hits: [], total: 0, unloadedLayers: [], error: EMPTY_FILTER_MESSAGE };
  }

  const keys = query.layers === 'all' ? [...EDITABLE_LAYER_KEYS] : query.layers;
  const hits: QueryHit[] = [];
  const unloadedLayers: EditableLayerKey[] = [];
  let total = 0;

  for (const layerKey of keys) {
    const features = readFeatures(map, layerKey);
    // Only a missing source (no layer/no source) means "not loaded". A source that
    // loaded successfully but genuinely has zero features is not the same thing —
    // folding the two together mis-reported an empty-but-loaded layer as unloaded.
    if (features === null) {
      unloadedLayers.push(layerKey);
      continue;
    }
    const matched = applyFilter(features, query.conditions) as IdFeature[];
    total += matched.length;
    for (const f of matched) {
      if (hits.length >= cap) continue;
      const props = f.getProperties();
      const { featureId } = parseFeatureId(String(f.getId?.() ?? ''));
      hits.push({
        layerKey,
        layerLabel: LAYER_LABELS[layerKey],
        featureId,
        label: String(props.geographicalName ?? props.localId ?? featureId),
        feature: f,
      });
    }
  }

  return { hits, total, unloadedLayers, error: null };
}
