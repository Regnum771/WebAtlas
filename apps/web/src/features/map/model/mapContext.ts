import type { Map } from 'ol';
import { transformExtent } from 'ol/proj';
import type { BasemapName, MapContext } from '@webatlas/shared';
import type { LayerState } from './MapModel';

export interface MapContextDeps {
  map: Map | null;
  basemap: BasemapName;
  layersState: LayerState[];
}

/**
 * Reads what the user is currently looking at off the map.
 *
 * Lives in features/map/model because it imports from 'ol' — the assistant
 * slice must not. It is the assistant's only window onto the map's state, the
 * mirror image of createCommandExecutor being its only lever on it.
 */
export function buildMapContext({ map, basemap, layersState }: MapContextDeps): MapContext | null {
  if (!map) return null;
  const view = map.getView();
  const zoom = view.getZoom();
  if (zoom === undefined) return null;

  const extent = view.calculateExtent(map.getSize());
  const [west, south, east, north] = transformExtent(extent, 'EPSG:3857', 'EPSG:4326');

  return {
    bbox: [round(west), round(south), round(east), round(north)],
    // Rounded so a map that has not moved produces a byte-identical context;
    // an unrounded float would differ on every render and make each turn's
    // user message needlessly unique.
    zoom: Math.round(zoom * 100) / 100,
    visibleLayerStateIds: layersState.filter((l) => l.visible).map((l) => l.id),
    basemap,
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
