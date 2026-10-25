import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unit, type DictAttribute } from '@webatlas/shared';
import { useDictionary } from './useDictionary';
import { dictionaryKeyFor } from './layerKeys';
import type { SheetRow } from '../ui/DictionarySheet.view';

/** A retired attribute has an end date that is not in the future. */
function isCurrent(attribute: DictAttribute, today: string): boolean {
  return !attribute.validTo || attribute.validTo > today;
}

function toRow(attribute: DictAttribute): SheetRow {
  const unitCode = attribute.displayUnit ?? attribute.storedUnit;
  return {
    name: attribute.name,
    label: attribute.label,
    unitSymbol: unitCode ? unit(unitCode).symbol : undefined,
    definition: attribute.definition,
    valueCount:
      attribute.valueType === 'code' && attribute.values
        ? attribute.values.filter((v) => !v.retired).length
        : undefined,
  };
}

/** Which layer's quick sheet is open (one at a time), and what it lists. */
export function useDictionarySheetPresenter() {
  const dictionary = useDictionary();
  const [open, setOpen] = useState<{ layerId: string; layerName: string } | null>(null);

  const openRef = useRef(open);
  openRef.current = open;

  const openSheet = useCallback((layerId: string, layerName: string) => {
    setOpen({ layerId, layerName });
  }, []);

  const close = useCallback(() => {
    const id = openRef.current?.layerId;
    setOpen(null);
    if (id) {
      // Return focus to the opener once the sheet is gone.
      queueMicrotask(() => {
        document.querySelector<HTMLElement>(`[data-dictionary-info="${CSS.escape(id)}"]`)?.focus();
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const sheet = useMemo(() => {
    if (!open) return null;
    const key = dictionaryKeyFor(open.layerId);
    const featureType = key ? dictionary[key] : undefined;
    if (!key || !featureType) return null;
    const today = new Date().toISOString().slice(0, 10);
    return {
      title: `${open.layerName} — thuộc tính`,
      dictionaryKey: key,
      rows: featureType.attributes.filter((a) => isCurrent(a, today)).map(toRow),
    };
  }, [open, dictionary]);

  return { openLayerId: open?.layerId ?? null, sheet, openSheet, close };
}
