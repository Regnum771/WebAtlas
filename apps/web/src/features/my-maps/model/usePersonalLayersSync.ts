import { useEffect, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMapContext } from '../../../app/providers/MapProvider';
import { layerView, setTruncated, useMyMapsStore } from './myMaps.store';
import { PERSONAL_Z_BASE, syncPersonalLayers, type PersonalLayerEntry } from './personalLayers';
import { dropGoneMap, isMapNotFound, keys, mapDetailQuery, useMyMaps } from './queries';
import { setStepsFor, useTimeSlider } from '../../time-slider/model/timeSlider.store';
import { unionSteps } from '../../time-slider/model/timeSteps';

/** The personal maps' share of the time slider's steps (the free-standing catalogue layers supply their own). */
const STEPS_SOURCE = 'personal';

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
    // The map is read again: the link then comes back with `catalogue: null` and its row says why.
    onCatalogueGone: (id: string) => { void qc.invalidateQueries({ queryKey: keys.map(id) }); },
  }));
  // Syncs only when something drawn changed, not on every render of the panel.
  const signature = JSON.stringify(entries.map((e) => [
    e.mapId, e.layer.id, e.layer.kind, e.layer.layerKey, e.layer.style, e.visible, e.opacity, e.zIndex,
    e.layer.catalogue?.id ?? null, e.layer.catalogue?.layerName ?? null,
  ]));
  // The visible time-series links supply their share of the time slider's steps.
  const steps = JSON.stringify(unionSteps(entries
    .filter((e) => e.visible && e.layer.kind === 'catalogue' && e.layer.catalogue?.kind === 'timeseries')
    .map((e) => e.layer.catalogue?.timeSteps ?? [])));
  const hasLinks = entries.some((e) => e.layer.kind === 'catalogue');
  const time = useTimeSlider().time;
  // Only links follow the slider: without any, a slider tick does not resync the personal layers.
  const linkTime = hasLinks ? time : null;

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
    if (map) syncPersonalLayers(map, latest.current, linkTime);
  }, [map, signature, linkTime]);
  useEffect(() => { setStepsFor(STEPS_SOURCE, JSON.parse(steps) as string[]); }, [steps]);

  useEffect(() => () => {
    if (map) syncPersonalLayers(map, []);
  }, [map]);
  useEffect(() => () => setStepsFor(STEPS_SOURCE, []), []);
}
