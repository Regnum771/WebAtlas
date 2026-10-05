import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';

/**
 * The river overview layer hands over EXACTLY at the full river layer's threshold.
 *
 * Read from LAYER_DISPLAY rather than copying 8.5: if the two layers overlapped even
 * slightly, bucket 3 would draw twice at two different simplifications, which reads
 * as a doubled river. A test keeps the two numbers equal.
 *
 * The overview itself is drawn from the API's `rivers_overview` vector tiles
 * (waterTiles.ts, MapModel).
 */
export const RIVER_OVERVIEW_MAX_ZOOM = LAYER_DISPLAY.layer_rivers.minZoom as number;

/** Below the threshold the overview draws; from the threshold up the full layer takes over. */
export function riverOverviewVisibleAt(zoom: number): boolean {
  return zoom < RIVER_OVERVIEW_MAX_ZOOM;
}
