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

/**
 * Zoom floor: must stay AT OR BELOW the zoom that fits the whole country,
 * otherwise the user could never zoom out far enough to see it all.
 *
 * Vietnam's N-S span is ~1,764,512 m in EPSG:3857 and the country is ~2.14x
 * taller than it is wide, so viewport HEIGHT is the binding constraint for
 * `view.fit`. The required fitting zoom grows with viewport height:
 *   ~5.96 @ 700px, ~6.15 @ 800px, ~6.47 @ 1000px tall.
 * 5.5 sits comfortably below all of those, so `view.fit` can always reach it
 * (and the user can zoom out slightly further than the fit if they want to).
 */
export const MAP_MIN_ZOOM = 5.5;

export const MAP_MAX_ZOOM = 20;

/**
 * Pre-fit initial view (OL's `View` constructor requires a center/zoom).
 * `MapModel.init` immediately calls `view.fit(VIETNAM_EXTENT_4326, ...)` once
 * the map has a real size, so these values are only ever visible for a single
 * frame before the fit takes over — they no longer determine what the user
 * actually sees on load.
 */
export const MAP_DEFAULT_CENTER_4326 = [108.2, 13.5] as const;
export const MAP_DEFAULT_ZOOM = 7;
