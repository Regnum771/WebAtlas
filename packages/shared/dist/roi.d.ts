/**
 * The region of interest (vùng phân tích): the one input every analysis tool takes
 * (docs/superpowers/specs/2026-09-30-roi-analysis-toolbar-design.md §9). The browser
 * holds an Roi — a reference, never geometry — and the server resolves it through
 * POST /api/roi/resolve, which is also what every analysis operation calls first.
 */
import type { EditableLayerKey } from './index.js';
import type { GeoJsonGeometry } from './geometry.js';
/** The basemap reference layers. apps/api/src/reference/registry.ts re-exports these. */
export declare const REFERENCE_LAYER_KEYS: readonly ["roads", "railways", "water", "landuse", "places"];
export type ReferenceLayerKey = (typeof REFERENCE_LAYER_KEYS)[number];
export declare const ROI_MAX_RADIUS_KM = 100;
export type RoiKind = 'area' | 'line' | 'point';
export type AdminLevel = 'province' | 'ward';
export type DrawnRoiGeometry = Extract<GeoJsonGeometry, {
    type: 'Point' | 'LineString' | 'Polygon';
}>;
export type Roi = {
    source: 'drawn';
    geometry: DrawnRoiGeometry;
    radiusKm?: number;
}
/** `whole: true` on a river way means the level-1 river it belongs to (FR-13). */
 | {
    source: 'feature';
    layerKey: EditableLayerKey;
    featureId: string;
    whole?: true;
    radiusKm?: number;
} | {
    source: 'reference';
    referenceLayer: ReferenceLayerKey;
    entityId: string;
    radiusKm?: number;
}
/** Never a radius: an admin unit is already an area (FR-4). */
 | {
    source: 'admin';
    level: AdminLevel;
    code: string;
};
export type RoiMeasure = {
    areaKm2: number;
} | {
    lengthKm: number;
} | null;
export interface ResolvedRoi {
    /** "Sông Thu Bồn + 5 km", "Tỉnh Đắk Lắk", "Hình vẽ". */
    label: string;
    /** After the radius is applied. */
    kind: RoiKind;
    measure: RoiMeasure;
    /** Simplified, for drawing only. */
    display: GeoJsonGeometry;
    /** [west, south, east, north], EPSG:4326. */
    bbox: [number, number, number, number];
    /** [lon, lat] — what Gần nhất measures from (D12). */
    centroid: [number, number];
}
/**
 * `roi` with its radius set (a number) or removed (null). An admin unit is returned
 * unchanged: it is already an area and never carries a radius.
 */
export declare function withRadius(roi: Roi, radiusKm: number | null): Roi;
