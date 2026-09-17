function isPosition(v) {
    return (Array.isArray(v) &&
        v.length >= 2 &&
        v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
        v[0] >= -180 && v[0] <= 180 &&
        v[1] >= -90 && v[1] <= 90);
}
function isLine(v) {
    return Array.isArray(v) && v.length >= 2 && v.every(isPosition);
}
function isRing(v) {
    return Array.isArray(v) && v.length >= 4 && v.every(isPosition);
}
function isPolygonCoords(v) {
    return Array.isArray(v) && v.length >= 1 && v.every(isRing);
}
export function isGeoJsonGeometry(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const g = value;
    const c = g.coordinates;
    switch (g.type) {
        case 'Point': return isPosition(c);
        case 'MultiPoint': return Array.isArray(c) && c.length >= 1 && c.every(isPosition);
        case 'LineString': return isLine(c);
        case 'MultiLineString': return Array.isArray(c) && c.length >= 1 && c.every(isLine);
        case 'Polygon': return isPolygonCoords(c);
        case 'MultiPolygon': return Array.isArray(c) && c.length >= 1 && c.every(isPolygonCoords);
        default: return false;
    }
}
/** Every position of a geometry, flattened. */
export function positionsOf(g) {
    switch (g.type) {
        case 'Point': return [g.coordinates];
        case 'MultiPoint':
        case 'LineString': return g.coordinates;
        case 'MultiLineString':
        case 'Polygon': return g.coordinates.flat();
        case 'MultiPolygon': return g.coordinates.flat(2);
    }
}
export function countVertices(g) {
    return positionsOf(g).length;
}
