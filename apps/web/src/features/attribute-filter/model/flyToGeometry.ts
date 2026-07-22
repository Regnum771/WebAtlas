import type { Map } from 'ol';
import type { Geometry } from 'ol/geom';

/**
 * Left padding reserves the drawer + detail panel, which overlay the map:
 * 12px offset + 360px drawer + 340px panel = 712px, plus a 20px breathing gap.
 * Keep in step with --drawer-width / --display-panel-width in main.css.
 */
export const DEFAULT_FIT_PADDING = [80, 80, 80, 732];
/** Stops a single point from fitting to street level. */
export const DEFAULT_FIT_MAX_ZOOM = 14;

/**
 * Frame a feature. Fits the geometry's EXTENT rather than centring on a coordinate:
 * a fixed centre+zoom lands mid-way along a long river showing no useful context, and
 * a line's getCoordinates() is nested and is not a valid view centre at all.
 */
export function flyToGeometry(
  map: Map | null,
  geom: Geometry | null | undefined,
  opts: { padding?: number[]; maxZoom?: number } = {},
): void {
  if (!map || !geom) return;
  map.getView().fit(geom.getExtent(), {
    padding: opts.padding ?? DEFAULT_FIT_PADDING,
    maxZoom: opts.maxZoom ?? DEFAULT_FIT_MAX_ZOOM,
    duration: 800,
  });
}
