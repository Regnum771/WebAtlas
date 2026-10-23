import { useEffect, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMapContext } from '../../../app/providers/MapProvider';
import { layerView, setTruncated, useMyMapsStore } from './myMaps.store';
import { PERSONAL_Z_BASE, syncPersonalLayers, type PersonalLayerEntry } from './personalLayers';
import { dropGoneMap, isMapNotFound, mapDetailQuery, useMyMaps } from './queries';

/**
 * Keeps the map's personal layers in step with the panel: the layers of every expanded map,
 * with the panel's visibility and opacity. Rows count top to bottom (own maps, then shared,
 * each map's layers by position) and the top row draws highest. Used once, in <MyMaps />; when
 * that unmounts (signing out) every personal layer leaves the map.
 */
export function usePersonalLayersSync(): void {
  const { map } = useMapContext();
  const store = useMyMapsStore();
  const qc = useQueryClient();
  const maps = useMyMaps();
  const expanded = [...(maps.data?.mine ?? []), ...(maps.data?.sharedWithMe ?? [])].filter((m) => store.expanded.has(m.id));
  const details = useQueries({ queries: expanded.map(mapDetailQuery) });

  const rows = expanded.flatMap((m, i) => {
    const detail = details[i].data;
    return detail ? [...detail.layers].sort((a, b) => a.position - b.position).map((layer) => ({ mapId: m.id, layer })) : [];
  });
  const entries: PersonalLayerEntry[] = rows.map(({ mapId, layer }, i) => ({
    mapId,
    layer,
    ...layerView(layer.id),
    zIndex: PERSONAL_Z_BASE + rows.length - 1 - i,
    onTruncated: setTruncated,
    onMapGone: (id: string) => dropGoneMap(qc, id, latest.current.filter((x) => x.mapId === id).map((x) => x.layer.id)),
  }));
  // Syncs only when something drawn changed, not on every render of the panel.
  const signature = JSON.stringify(entries.map((e) => [
    e.mapId, e.layer.id, e.layer.kind, e.layer.layerKey, e.layer.style, e.visible, e.opacity, e.zIndex,
  ]));

  const latest = useRef(entries);
  useEffect(() => { latest.current = entries; });
  // A map read that answers the map's own 404 (unshared or deleted): drop it and its layers.
  useEffect(() => {
    expanded.forEach((m, i) => {
      if (isMapNotFound(details[i].error)) {
        dropGoneMap(qc, m.id, latest.current.filter((x) => x.mapId === m.id).map((x) => x.layer.id));
      }
    });
    // `expanded` and `details` are rebuilt every render; the errors are what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, details.map((d) => d.error).join('|')]);
  useEffect(() => {
    if (map) syncPersonalLayers(map, latest.current);
  }, [map, signature]);

  useEffect(() => () => {
    if (map) syncPersonalLayers(map, []);
  }, [map]);
}
