import type { DictFeatureType } from '../types.js';
/**
 * PNG frames, one per scenario hour, not a table (Ruling 3). A frame encodes depth in 0.25 m
 * steps up to 4 m and is transparent where dry, so the band has no numeric nodata
 * (apps/web/src/features/flood-scenario/model/depthColour.ts).
 */
export declare const flood_depth: DictFeatureType;
