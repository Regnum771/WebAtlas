import type { GeoJsonGeometry } from '@webatlas/shared';

/** The most recent shape the user drew (measure or analysis), in EPSG:4326, so the
 *  next analysis can reuse it — "đo một vùng rồi chọn các đập trong vùng đó". */
let last: GeoJsonGeometry | null = null;

export function setLastShape(g: GeoJsonGeometry): void { last = g; }
export function getLastShape(): GeoJsonGeometry | null { return last; }
