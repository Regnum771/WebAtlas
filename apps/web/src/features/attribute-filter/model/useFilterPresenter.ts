import { useCallback, useMemo, useState } from 'react';
import {
  LAYER_FILTER_FIELDS,
  LAYER_ATTRIBUTE_MAP,
  type FilterField,
  type EditableLayerKey,
} from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { applyFilter, type Condition, type FeatureLike } from './applyFilter';

export interface FilterResult {
  id: string;          // stable per-result id (index-based; features lack a guaranteed id here)
  label: string;       // geographicalName or a fallback
  subLabel: string;    // a secondary attribute for context
  hasGeometry: boolean;
}

// Filtering is a display tool. No auth, no fetch — it reads what the map already has.
export function useFilterPresenter() {
  const { map } = useMapContext();
  const [isOpen, setIsOpen] = useState(false);
  const [layerKey, setLayerKey] = useState<EditableLayerKey | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);

  const fields: FilterField[] = useMemo(
    () => (layerKey ? LAYER_FILTER_FIELDS[layerKey] : []),
    [layerKey],
  );

  // The live OL features for the active layer, or null if the layer isn't loaded.
  const liveFeatures = useMemo((): FeatureLike[] | null => {
    if (!map || !layerKey) return null;
    const stateId = LAYER_ATTRIBUTE_MAP[layerKey].layerStateId;
    const layer = map.getLayers().getArray().find((l: { get(k: string): unknown }) => l.get('id') === stateId) as
      | { getSource(): { getFeatures(): FeatureLike[] } | null }
      | undefined;
    const src = layer?.getSource?.();
    if (!src) return null;
    return src.getFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, layerKey]);

  const layerLoaded = liveFeatures !== null && liveFeatures.length > 0;

  const matched = useMemo(
    () => (liveFeatures ? applyFilter(liveFeatures, conditions) : []),
    [liveFeatures, conditions],
  );

  const results: FilterResult[] = useMemo(
    () =>
      matched.map((f, i) => {
        const p = f.getProperties();
        const secondary = fields.find((fl) => fl.iso !== 'geographicalName');
        return {
          id: String(i),
          label: String(p.geographicalName ?? p.localId ?? `#${i + 1}`),
          subLabel: secondary ? String(p[secondary.iso] ?? '') : '',
          hasGeometry: !!f.getGeometry(),
        };
      }),
    [matched, fields],
  );

  const setLayer = useCallback((key: EditableLayerKey) => {
    setLayerKey(key);
    setConditions([]);
  }, []);
  const addCondition = useCallback(() => {
    setConditions((cs) => [...cs, { field: fields[0]?.iso ?? '', op: 'eq', value: '' }]);
  }, [fields]);
  const updateCondition = useCallback((i: number, patch: Partial<Condition>) => {
    setConditions((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }, []);
  const removeCondition = useCallback((i: number) => {
    setConditions((cs) => cs.filter((_, idx) => idx !== i));
  }, []);
  const clear = useCallback(() => setConditions([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const flyTo = useCallback(
    (id: string) => {
      if (!map) return;
      const f = matched[Number(id)];
      const geom = f?.getGeometry() as { getCoordinates?: () => number[] } | null;
      const coords = geom?.getCoordinates?.();
      if (!coords) return;
      // Features are in EPSG:3857 already (source reprojects on load); animate to the map coord.
      map.getView().animate({ center: coords, zoom: 11, duration: 1000 });
      setIsOpen(false);
    },
    [map, matched],
  );

  return {
    isOpen, layerKey, fields, conditions, results,
    count: results.length,
    activeCount: conditions.length,
    layerLoaded,
    setLayer, addCondition, updateCondition, removeCondition, clear,
    open, close, flyTo,
  };
}
