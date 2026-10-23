import { useQueries, useQuery } from '@tanstack/react-query';
import { LAYER_ATTRIBUTE_MAP, LAYER_PALETTE, type EditableLayerKey } from '@webatlas/shared';
import * as api from '../api/workspace.api';
import type { LayerSummary, MapDetail } from '../api/workspace.api';
import { layerView, useMyMapsStore } from './myMaps.store';
import { DEFAULT_STYLE, parseStyle } from './personalStyle';
import { keys } from './queries';

/** One row of the print legend's "Bản của tôi" group. */
export interface PersonalLegendItem {
  id: string;
  title: string;
  /** The swatch colour; a raster shows a grey-to-colour bar ending in it. */
  color: string;
  raster: boolean;
}

/**
 * An edit copy is drawn with the official layer's style, so its swatch is that layer's palette
 * colour; a layer key without one falls back to the default personal colour.
 */
function colorOf(layer: LayerSummary): string {
  if (layer.kind === 'edit_copy' && layer.layerKey) {
    const stateId = LAYER_ATTRIBUTE_MAP[layer.layerKey as EditableLayerKey]?.layerStateId;
    return (stateId && LAYER_PALETTE[stateId]?.color) || DEFAULT_STYLE.color;
  }
  return parseStyle(layer.style).color;
}

/** The visible layers of the given maps, in the panel's order (map by map, layers by position). */
export function personalLegendItems(details: MapDetail[]): PersonalLegendItem[] {
  return details.flatMap((d) =>
    [...d.layers]
      .sort((a, b) => a.position - b.position)
      .filter((l) => layerView(l.id).visible)
      .map((l) => ({ id: l.id, title: l.title, color: colorOf(l), raster: l.kind === 'raster' })),
  );
}

/**
 * The print page's personal legend: the expanded maps (the ones drawn on the map) and their
 * visible layers. Reads the panel's cached lists and details; an anonymous visitor reads nothing.
 */
export function usePersonalLegend(enabled: boolean): PersonalLegendItem[] {
  const store = useMyMapsStore();
  const maps = useQuery({ queryKey: keys.maps, queryFn: api.listMaps, enabled });
  const expanded = enabled
    ? [...(maps.data?.mine ?? []), ...(maps.data?.sharedWithMe ?? [])].filter((m) => store.expanded.has(m.id))
    : [];
  const details = useQueries({
    queries: expanded.map((m) => ({ queryKey: keys.map(m.id), queryFn: () => api.getMap(m.id) })),
  });
  return personalLegendItems(details.flatMap((d) => (d.data ? [d.data] : [])));
}
