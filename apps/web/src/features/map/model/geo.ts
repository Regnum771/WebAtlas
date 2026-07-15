import GeoJSON from 'ol/format/GeoJSON';
import type Geometry from 'ol/geom/Geometry';

export interface GeoJSONGeometry {
  type: string;
  coordinates: unknown;
}

const MAP_PROJECTION = 'EPSG:3857';
const DATA_PROJECTION = 'EPSG:4326';
const format = new GeoJSON();

/**
 * Convert an OpenLayers geometry (in the map projection, EPSG:3857) to a plain
 * GeoJSON geometry object in EPSG:4326. Works on a clone — the source is untouched.
 */
export function olGeometryTo4326GeoJSON(geom: Geometry): GeoJSONGeometry {
  return format.writeGeometryObject(geom, {
    dataProjection: DATA_PROJECTION,
    featureProjection: MAP_PROJECTION,
  }) as unknown as GeoJSONGeometry;
}

/**
 * Parse a GeoJSON geometry (EPSG:4326) into an OpenLayers geometry in the map
 * projection (EPSG:3857). Used by the modify/move plan; tested here.
 */
export function geoJSON4326ToOlGeometry(geojson: GeoJSONGeometry): Geometry {
  return format.readGeometry(geojson, {
    dataProjection: DATA_PROJECTION,
    featureProjection: MAP_PROJECTION,
  });
}
