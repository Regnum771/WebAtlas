/**
 * Geographic sanity bounds, shared by everything that accepts a coordinate from
 * outside the system.
 *
 * This used to live in modules/assistant/tools/command/zoomToFeature.ts, which
 * made three data tools and (now) an HTTP route import from a command tool for a
 * pure predicate. It is not assistant-specific: any coordinate arriving from a
 * model, a query string or a click gets the same check.
 */

/** Rough Vietnam bounding box, generous on every side. */
export const VIETNAM_BOUNDS = { west: 102, east: 110, south: 8, north: 24 } as const;

/**
 * Is this coordinate plausibly in Vietnam?
 *
 * The point of the check is not precision, it is catching the two failure modes
 * that produce confident nonsense: a (0, 0) from a null-island row, which would
 * fly the map into the Atlantic and report success, and a coordinate a model
 * recalled from memory for somewhere else entirely.
 */
export function inVietnam(lon: number, lat: number): boolean {
  return (
    lon >= VIETNAM_BOUNDS.west &&
    lon <= VIETNAM_BOUNDS.east &&
    lat >= VIETNAM_BOUNDS.south &&
    lat <= VIETNAM_BOUNDS.north
  );
}
