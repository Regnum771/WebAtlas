/**
 * Conversions between the Web Mercator zoom level and the map scale (scale denominator).
 *
 * Standard OGC formula: scale = resolution * (DPI / 0.0254), where
 * resolution (m/px) = (2 * PI * R / 256) / 2^zoom * cos(latitude).
 *
 * The scale depends on latitude, so every number here refers to REFERENCE_LATITUDE
 * (~16°N, the middle of Vietnam) so that one zoom level always maps to one stable scale.
 */

/** WGS84 Earth radius (m). */
const EARTH_RADIUS_M = 6378137;
/** Conventional screen DPI per OGC. */
const SCREEN_DPI = 96;
const INCH_M = 0.0254;

/** Reference latitude for scale calculations — the middle of Vietnam. */
export const REFERENCE_LATITUDE = 16;

/** Resolution (m/px) at a zoom level, at the given latitude. */
export function resolutionAtZoom(zoom: number, latitude = REFERENCE_LATITUDE): number {
  return (
    ((2 * Math.PI * EARTH_RADIUS_M) / 256 / Math.pow(2, zoom)) *
    Math.cos((latitude * Math.PI) / 180)
  );
}

/** Map scale denominator at a zoom level (e.g. 100000 means 1:100.000). */
export function scaleAtZoom(zoom: number, latitude = REFERENCE_LATITUDE): number {
  return resolutionAtZoom(zoom, latitude) * (SCREEN_DPI / INCH_M);
}

/** Zoom level for a scale denominator (the inverse of scaleAtZoom). */
export function zoomForScale(scale: number, latitude = REFERENCE_LATITUDE): number {
  const resolution = scale / (SCREEN_DPI / INCH_M);
  return Math.log2(((2 * Math.PI * EARTH_RADIUS_M) / 256) * Math.cos((latitude * Math.PI) / 180) / resolution);
}

/**
 * Fully zoomed out: 1:12.800.000 — the whole of VIETNAM_EXTENT_4326 (~1,725 km
 * north–south) fits in a ~900 px tall viewport (taking 509 px) with room to spare.
 *
 * WHY EXACTLY THIS NUMBER, NOT 7.500.000 AS BEFORE: ol/View computes
 *   maxZoom = minZoom + floor(log2(maxResolution / minResolution))
 * so the zoom range is TRUNCATED down to a whole number of zoom levels. The old
 * pair 7.500.000 -> 100.000 spanned log2(75) = 6.2289 levels, truncated to 6, so
 * the map stopped at 1:117.188 and never reached the 1:100.000 the constant advertised.
 *
 * The current pair spans EXACTLY 9 levels (12.800.000 / 25.000 = 512 = 2^9), so
 * nothing is truncated. To change the limits, the MIN_SCALE/MAX_SCALE ratio must
 * be a power of 2 — a test keeps that condition. Note that DPI and latitude do NOT
 * help here: they cancel out of the ratio.
 */
export const MIN_SCALE = 12_800_000;
/** Fully zoomed in: 1:25.000. See MIN_SCALE for the power-of-2 constraint. */
export const MAX_SCALE = 25_000;

export const MIN_ZOOM = zoomForScale(MIN_SCALE);
export const MAX_ZOOM = zoomForScale(MAX_SCALE);

/** Bounding box of all of mainland Vietnam (lon/lat, EPSG:4326). */
export const VIETNAM_EXTENT_4326: [number, number, number, number] = [102.0, 8.0, 110.0, 23.5];

/** Default centre for "back to the full view" (lon/lat). */
export const VIETNAM_CENTER_4326: [number, number] = [106.5, 16.0];

/**
 * The view WHEN THE APP OPENS — the working region (South Central Coast & Central
 * Highlands), the MAINLAND part: 107.2–110.6°E / 7.3–16.2°N, i.e. 374 x 988 km.
 * (Hoàng Sa/Trường Sa are left out: they belong to Đà Nẵng/Khánh Hòa but lie far
 * offshore, and including them would pull the map centre into the East Sea.)
 *
 * Why open here rather than nationwide: the thematic data exists only inside the
 * working region, so opening nationwide would both show a vast empty area and force
 * the bbox strategy to load ALL the data up front (the viewport at MIN_ZOOM is
 * 2,172 km wide, enclosing all of Vietnam). Opening on the working region lets the
 * bbox load only what is actually visible.
 *
 * This is NOT a limit: users can still zoom out to MIN_ZOOM to see the whole country.
 */
export const INITIAL_CENTER_4326: [number, number] = [108.93, 11.77];

/** Zoom level when the app opens — just enough to cover the working region north to south. */
export const INITIAL_ZOOM = 7;

/** Formats a scale denominator as a "1:100.000" label (Vietnamese dot thousands separator). */
export function formatScale(scale: number): string {
  const rounded = Math.round(scale);
  return `1:${rounded.toLocaleString('vi-VN')}`;
}

/**
 * Round-number scale stops for the zoom slider, from small (far) to large (near).
 * Only stops inside [MIN_SCALE, MAX_SCALE] are kept.
 */
export const ZOOM_SCALE_LEVELS: number[] = [
  12_800_000, 7_500_000, 5_000_000, 3_000_000, 1_750_000, 1_000_000, 500_000, 250_000, 100_000,
  50_000, 25_000,
];

/**
 * The eleven scale stops as zoom levels, ascending — index 0 is the most zoomed
 * out (1:12.800.000), the last index the most zoomed in (1:25.000). Sorted
 * rather than mapped positionally so the slider keeps working bottom-to-top if
 * someone reorders ZOOM_SCALE_LEVELS.
 */
export const ZOOM_STOPS: readonly number[] = ZOOM_SCALE_LEVELS.map((scale) => zoomForScale(scale)).sort(
  (a, b) => a - b,
);

/** Index of the stop closest to a zoom. Ties go to the lower index. */
export function nearestStopIndex(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STOPS.length; i++) {
    if (Math.abs(ZOOM_STOPS[i] - zoom) < Math.abs(ZOOM_STOPS[best] - zoom)) {
      best = i;
    }
  }
  return best;
}

/** The two scales section 22 names. */
export const NAMED_SCALES: ReadonlyMap<number, string> = new Map([
  [100_000, 'cấp tỉnh'],
  [250_000, 'cấp vùng'],
]);

/** Is the stop at this ZOOM_STOPS index one of the named scales? */
export function isNamedStop(index: number): boolean {
  return namedScaleAt(ZOOM_STOPS[index]) !== null;
}

/** The name to show under the readout: only while the view's scale is within 1 of a named scale. */
export function namedScaleAt(zoom: number): string | null {
  const scale = scaleAtZoom(zoom);
  for (const [named, name] of NAMED_SCALES) {
    if (Math.abs(scale - named) < 1) return name;
  }
  return null;
}

/**
 * The stop the + (1) or − (−1) button moves to: the nearest stop; if the view is
 * already short of that stop in the direction of travel, that stop itself,
 * otherwise the next one in that direction. Clamped to the stop range.
 */
export function stepStopIndex(zoom: number, direction: 1 | -1): number {
  const nearest = nearestStopIndex(zoom);
  const stop = ZOOM_STOPS[nearest];
  const shortOfStop = direction === 1 ? stop > zoom + 0.05 : stop < zoom - 0.05;
  const target = shortOfStop ? nearest : nearest + direction;
  return Math.min(ZOOM_STOPS.length - 1, Math.max(0, target));
}

/** Significant digits the scale number is rounded to when the view settles. */
export const SIGNIFICANT_DIGITS = 3;

/**
 * Rounds a scale denominator to SIGNIFICANT_DIGITS significant digits, clamped to
 * the zoom limits so one snap cannot push the view past MIN_SCALE/MAX_SCALE.
 *
 * IT USED TO be a fixed 1.000-unit grid. A fixed grid was fine while the range only
 * reached 1:100.000 (a 1% step), but at 1:25.000 it becomes a 4% step — coarse
 * enough to see the number jump when zooming at the near end. Three significant
 * digits is a PROPORTIONAL grid, so the step feels the same everywhere in the range.
 *
 * Every stop in ZOOM_SCALE_LEVELS is already a 3-significant-digit number, so a
 * zoom made by the slider or the buttons lands on a value this function leaves
 * alone — the two snappings do not fight. A test keeps that true.
 */
export function snapScaleForReadout(scale: number): number {
  const exponent = Math.floor(Math.log10(scale)) - (SIGNIFICANT_DIGITS - 1);
  const step = Math.pow(10, exponent);
  const snapped = Math.round(scale / step) * step;
  return Math.min(MIN_SCALE, Math.max(MAX_SCALE, snapped));
}

/**
 * How close a scale must already be to its snapped value to count as settled.
 *
 * NOT half the snapping step. Because snapScaleForReadout rounds, every possible
 * input is within half a step of its own snapped value — a guard that wide
 * would return null for everything and the map would never snap at all. What
 * distinguishes a settled view is that its scale IS its snapped value, which is
 * only true after a correction has been applied. One unit of denominator is far
 * below anything visible and far above the float round-trip error through
 * zoomForScale/scaleAtZoom.
 */
const SETTLED_EPSILON = 1;

/**
 * The zoom the view should be corrected to once it settles, or null if it is
 * already on a round scale and must be left alone.
 *
 * Returning null is what terminates the moveend cycle in MapModel — see the
 * loop-guard test in zoomScale.test.ts.
 */
export function settleZoomCorrection(zoom: number): number | null {
  const scale = scaleAtZoom(zoom);
  const snapped = snapScaleForReadout(scale);
  if (Math.abs(scale - snapped) < SETTLED_EPSILON) return null;
  return zoomForScale(snapped);
}

/**
 * Scale denominator for an OpenLayers resolution (Mercator metres, EPSG:3857).
 *
 * OL returns a resolution without latitude correction, whereas resolutionAtZoom
 * above returns the GROUND resolution (already multiplied by cos). Multiplying by
 * cos here makes both paths yield the same scale — otherwise the LOD thresholds and
 * the scale number on the toolbar would disagree.
 */
export function scaleAtResolution(resolution: number, latitude = REFERENCE_LATITUDE): number {
  return resolution * Math.cos((latitude * Math.PI) / 180) * (SCREEN_DPI / INCH_M);
}
