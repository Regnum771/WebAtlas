/**
 * Zoom thresholds for the tile layers. Both are API vector tiles: a hidden layer requests nothing,
 * so the thresholds alone gate loading (see recomputeVisibility() in MapModel).
 */

/** Zoom threshold from which ward boundaries draw — see recomputeVisibility() in MapModel. */
export const WARDS_MIN_ZOOM = 10.0;

/**
 * Zoom threshold from which rivers and lakes draw (the river overview covers below it).
 *
 * Why 8.5: the work area is 374 km wide but 988 km TALL, so no zoom level shows the
 * whole area at a detail where the full river network is readable. Below 8.5 the
 * region's river network is too dense to read anyway, so nothing is lost.
 */
export const WATER_MIN_ZOOM = 8.5;
