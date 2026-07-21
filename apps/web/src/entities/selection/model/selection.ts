import type { EditableLayerKey } from '@webatlas/shared';
import type Feature from 'ol/Feature';

/**
 * What is currently selected on the map. Role-agnostic and mode-free: any user can
 * select any feature at any time, by clicking the map or from a result list.
 *
 * This deliberately carries the LIVE OpenLayers feature rather than a serialised
 * copy — editing derives its GeoJSON/denormalised shape from it on demand (Task 7),
 * so read-only consumers never pay for that conversion.
 */
export interface Selection {
  layerKey: EditableLayerKey;
  featureId: string;
  feature: Feature;
  isoProps: Record<string, unknown>;
}

/**
 * WFS feature ids arrive as "<typename>.<uuid>" (e.g. "dams.a1b2c3"). Split on the
 * FIRST dot only — the id portion may itself contain dots.
 */
export function parseFeatureId(rawId: string): { typename: string; featureId: string } {
  const dot = rawId.indexOf('.');
  if (dot < 0) return { typename: '', featureId: rawId };
  return { typename: rawId.slice(0, dot), featureId: rawId.slice(dot + 1) };
}

/** Map a WFS typename to its editable layer key, or null if it is not a thematic layer. */
export function resolveLayerKey(
  typename: string,
  layerKeyByStateId: Record<string, EditableLayerKey>,
): EditableLayerKey | null {
  if (typename === '') return null;
  const values = Object.values(layerKeyByStateId) as string[];
  return values.includes(typename) ? (typename as EditableLayerKey) : null;
}
