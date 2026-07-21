import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LAYER_FILTER_FIELDS,
  LAYER_ATTRIBUTE_MAP,
  type FilterField,
  type FilterFieldType,
  type EditableLayerKey,
} from '@webatlas/shared';
import type { Map as OlMap } from 'ol';
import type { Geometry } from 'ol/geom';
import { useMapContext } from '../../../app/providers/MapProvider';
import { useSelection } from '../../../entities/selection';
import { type Condition, type Operator } from './applyFilter';
import { runQuery, DEFAULT_RESULT_CAP } from './runQuery';
import { flyToGeometry } from './flyToGeometry';

// The sane default operator per field type, kept explicit (not a chained ternary) so a
// future fifth FilterFieldType is a TypeScript error here rather than silently falling
// through to a default the corresponding <select> may not even offer.
//   * enum -> 'eq' (exact match)
//   * text -> 'contains' (substring)
//   * number/date -> 'gte' (ConditionRow's numeric <select> renders both the same way —
//     see isNumeric in ConditionRow.view.tsx — and only offers gte/lte/eq; 'gte' is its
//     first option and the most common "at least this much" intent).
const DEFAULT_OP_BY_FIELD_TYPE: Record<FilterFieldType, Operator> = {
  enum: 'eq',
  text: 'contains',
  number: 'gte',
  date: 'gte',
};

function defaultOpForFieldType(type: FilterFieldType | undefined): Operator {
  // undefined (no matching field found) falls back to 'contains', same as before.
  if (type === undefined) return 'contains';
  return DEFAULT_OP_BY_FIELD_TYPE[type];
}

export interface FilterResult {
  id: string;          // the feature's REAL identity (runQuery's featureId), not an index
  label: string;       // geographicalName or a fallback
  layerLabel: string;
  hasGeometry: boolean;
}

// Filtering is a display tool. No auth, no fetch — it reads what the map already has,
// via the same runQuery engine the top-bar search uses.
export function useFilterPresenter() {
  const { map } = useMapContext();
  const { selectById } = useSelection();
  const [isOpen, setIsOpen] = useState(false);
  const [layerKey, setLayerKey] = useState<EditableLayerKey | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  // Bumps when the active layer's source finishes (re)loading features, so the query
  // memo below re-runs — otherwise enabling an off layer from the panel would never
  // flip unloadedLayers (the async load changes neither map nor layerKey).
  const [loadTick, setLoadTick] = useState(0);

  const fields: FilterField[] = useMemo(
    () => (layerKey ? LAYER_FILTER_FIELDS[layerKey] : []),
    [layerKey],
  );

  // Subscribe to the active layer's source so a late WFS load re-triggers derivation.
  useEffect(() => {
    if (!map || !layerKey) return;
    const stateId = LAYER_ATTRIBUTE_MAP[layerKey].layerStateId;
    const layer = map.getLayers().getArray().find(
      (l: { get(k: string): unknown }) => l.get('id') === stateId,
    ) as { getSource(): { on(t: string, h: () => void): void; un(t: string, h: () => void): void } | null } | undefined;
    const src = layer?.getSource?.();
    if (!src) return;
    const bump = () => setLoadTick((t) => t + 1);
    // 'change' fires on featuresloadend (wfsSource.ts calls source.changed()).
    src.on('change', bump);
    return () => src.un('change', bump);
  }, [map, layerKey]);

  const query = useMemo(
    () => ({ layers: layerKey ? [layerKey] : [], conditions }),
    [layerKey, conditions],
  );

  const queryResult = useMemo(
    () => runQuery(map as OlMap | null, query, DEFAULT_RESULT_CAP),
    // loadTick forces a re-read when a late WFS load changes the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, query, loadTick],
  );

  const results: FilterResult[] = useMemo(
    () => queryResult.hits.map((h) => ({
      id: h.featureId,
      label: h.label,
      layerLabel: h.layerLabel,
      hasGeometry: !!h.feature.getGeometry(),
    })),
    [queryResult],
  );

  const setLayer = useCallback((key: EditableLayerKey) => {
    setLayerKey(key);
    setConditions([]);
  }, []);
  const addCondition = useCallback(() => {
    const first = fields[0];
    const op = defaultOpForFieldType(first?.type);
    setConditions((cs) => [...cs, { field: first?.iso ?? '', op, value: '' }]);
  }, [fields]);
  const updateCondition = useCallback((i: number, patch: Partial<Condition>) => {
    setConditions((cs) =>
      cs.map((c, idx) => {
        if (idx !== i) return c;
        const next = { ...c, ...patch };
        // When the field changes, carry that field's unit scale (e.g. km) so applyFilter
        // compares in the user's units, and pick a sane default operator for the new
        // field's type (see DEFAULT_OP_BY_FIELD_TYPE above).
        if (patch.field !== undefined) {
          const nextField = fields.find((fl) => fl.iso === patch.field);
          next.scale = nextField?.scale;
          if (patch.op === undefined) {
            next.op = defaultOpForFieldType(nextField?.type);
          }
        }
        return next;
      }),
    );
  }, [fields]);
  const removeCondition = useCallback((i: number) => {
    setConditions((cs) => cs.filter((_, idx) => idx !== i));
  }, []);
  const clear = useCallback(() => setConditions([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const onResultClick = useCallback((id: string) => {
    const hit = queryResult.hits.find((h) => h.featureId === id);
    if (!hit) return;
    selectById(hit.layerKey, hit.featureId);
    flyToGeometry(map as OlMap | null, hit.feature.getGeometry() as Geometry | null);
  }, [queryResult, selectById, map]);

  return {
    isOpen, layerKey, fields, conditions, results,
    count: queryResult.total,
    shownCount: results.length,
    activeCount: conditions.length,
    unloadedLayers: queryResult.unloadedLayers,
    error: queryResult.error,
    setLayer, addCondition, updateCondition, removeCondition, clear,
    open, close, onResultClick,
  };
}
