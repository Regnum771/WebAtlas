import type { DictFeatureType, Dictionary } from './types.js';

/** A served feature type replaces the default with the same key; defaults fill the rest. */
export function mergeDictionary(
  defaults: Dictionary,
  served?: readonly DictFeatureType[],
): Dictionary {
  if (!served) return defaults;
  const merged: Record<string, DictFeatureType> = { ...defaults };
  for (const featureType of served) merged[featureType.key] = featureType;
  return merged;
}
