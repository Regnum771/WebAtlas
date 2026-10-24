import type { DictFeatureType, Dictionary } from './types.js';
/** A served feature type replaces the default with the same key; defaults fill the rest. */
export declare function mergeDictionary(defaults: Dictionary, served?: readonly DictFeatureType[]): Dictionary;
