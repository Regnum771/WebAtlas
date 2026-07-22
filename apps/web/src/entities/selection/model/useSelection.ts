import { createContext, useContext } from 'react';
import type { EditableLayerKey } from '@webatlas/shared';
import type { Selection } from './selection';

export interface SelectionValue {
  selection: Selection | null;
  selectById: (layerKey: EditableLayerKey, featureId: string) => Selection | null;
  clear: () => void;
}

export const SelectionContext = createContext<SelectionValue | undefined>(undefined);

export function useSelection(): SelectionValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within a SelectionProvider');
  return ctx;
}
