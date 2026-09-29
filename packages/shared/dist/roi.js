/** The basemap reference layers. apps/api/src/reference/registry.ts re-exports these. */
export const REFERENCE_LAYER_KEYS = ['roads', 'railways', 'water', 'landuse', 'places'];
export const ROI_MAX_RADIUS_KM = 100;
/**
 * `roi` with its radius set (a number) or removed (null). An admin unit is returned
 * unchanged: it is already an area and never carries a radius.
 */
export function withRadius(roi, radiusKm) {
    if (roi.source === 'admin')
        return roi;
    const { radiusKm: _previous, ...rest } = roi;
    void _previous;
    return (radiusKm === null ? rest : { ...rest, radiusKm });
}
