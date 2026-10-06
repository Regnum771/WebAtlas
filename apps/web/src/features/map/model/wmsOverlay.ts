import type Map from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';

/**
 * Adds a WMS overlay to the map. A wrong address or layer name only shows once tiles are
 * requested: if a tile fails before any has loaded, the layer is taken off again and
 * `onError` is called, once. After the first loaded tile the layer is left alone.
 */
export function addWmsOverlay(map: Map, layer: { url: string; layerName: string }, onError: () => void): void {
  const source = new TileWMS({
    url: layer.url,
    params: { LAYERS: layer.layerName, TILED: true },
    serverType: 'geoserver',
    crossOrigin: 'anonymous',
  });
  const overlay = new TileLayer({ source, properties: { id: `wms_${Date.now()}` } });

  const stopListening = () => {
    source.un('tileloadend', stopListening);
    source.un('tileloaderror', onFirstTileError);
  };
  function onFirstTileError() {
    stopListening();
    map.removeLayer(overlay);
    onError();
  }
  source.on('tileloadend', stopListening);
  source.on('tileloaderror', onFirstTileError);

  map.addLayer(overlay);
}
