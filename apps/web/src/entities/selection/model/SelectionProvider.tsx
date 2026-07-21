import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditableLayerKey } from '@webatlas/shared';
import { useMapContext } from '../../../app/providers/MapProvider';
import { LAYER_REGISTRY } from '../../layer/layerRegistry';
import { SelectionController } from './SelectionController';
import { SelectionContext } from './useSelection';
import type { Selection } from './selection';

export function SelectionProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext();
  const controllerRef = useRef<SelectionController | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (!map) return;
    const layerKeyByStateId: Record<string, EditableLayerKey> = {};
    for (const e of LAYER_REGISTRY) layerKeyByStateId[e.layerStateId] = e.layerKey;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, layerKeyByStateId);
    c.activate(setSelection);
    controllerRef.current = c;
    return () => {
      c.dispose();
      controllerRef.current = null;
      setSelection(null);
    };
  }, [map]);

  const selectById = useCallback(
    (layerKey: EditableLayerKey, featureId: string) =>
      controllerRef.current?.selectById(layerKey, featureId) ?? null,
    [],
  );
  const clear = useCallback(() => controllerRef.current?.clear(), []);

  return (
    <SelectionContext.Provider value={{ selection, selectById, clear }}>
      {children}
    </SelectionContext.Provider>
  );
}
