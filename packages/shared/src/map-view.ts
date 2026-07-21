/**
 * Map view constraints — the single source of truth for both the OpenLayers View
 * (MapModel) and the zoom buttons (MapControls). These previously disagreed:
 * MapModel used minZoom 4.0 while MapControls defaulted its own state to 6, so the
 * scroll wheel and the buttons enforced different floors.
 */

/**
 * Vietnam's bounding box in EPSG:4326 as [minLon, minLat, maxLon, maxLat].
 * The view extent was previously [107.0, 10.5, 109.5, 16.5] — a south-central
 * coastal strip that excluded the Mekong Delta, Ho Chi Minh City, Hanoi and the
 * entire north, so most of the country could not be panned to.
 */
export const VIETNAM_EXTENT_4326 = [102.1, 8.2, 109.5, 23.4] as const;

/** Zoom floor: the country fits the viewport. Tuned during /run. */
export const MAP_MIN_ZOOM = 5.5;

export const MAP_MAX_ZOOM = 20;

/** Opening view — unchanged from the previous hard-coded values. */
export const MAP_DEFAULT_CENTER_4326 = [108.2, 13.5] as const;
export const MAP_DEFAULT_ZOOM = 7;
