import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { LAYER_ATTRIBUTE_MAP, normalizeFeatureProperties, type EditableLayerKey } from '@webatlas/shared';
import { GEOSERVER_URL } from '../config';

function wfsUrl(typeName: string): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
  });
  return `${GEOSERVER_URL}/ows?${params.toString()}`;
}

/**
 * VectorSource for a thematic layer served from GeoServer WFS as GeoJSON.
 * - Reprojects EPSG:4326 -> EPSG:3857 (map view projection).
 * - Drops features with no geometry (e.g. coordinate-less dams).
 * - Renames properties to ISO/INSPIRE names and stamps `layerKey`.
 */
export function createWfsVectorSource(layerKey: EditableLayerKey): VectorSource {
  const info = LAYER_ATTRIBUTE_MAP[layerKey];
  const format = new GeoJSON();
  const source = new VectorSource({
    format,
    url: () => wfsUrl(info.wfsTypeName),
    strategy: bboxStrategy,
  });

  // Normalize + filter once features are loaded for this source.
  source.on('featuresloadend', (evt) => {
    const loaded = (evt as unknown as { features?: Feature[] }).features ?? source.getFeatures();
    for (const f of loaded) {
      if (!f.getGeometry()) {
        source.removeFeature(f);
        continue;
      }
      const raw = f.getProperties();
      // OpenLayers stores geometry under the geometry key; drop it before renaming props.
      const geomKey = f.getGeometryName();
      const dbProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k !== geomKey) dbProps[k] = v;
      }
      const iso = normalizeFeatureProperties(layerKey, dbProps);
      // Replace all non-geometry properties with the ISO-named set.
      for (const k of Object.keys(dbProps)) f.unset(k, true);
      f.setProperties(iso, true);
    }
    source.changed();
  });

  return source;
}
