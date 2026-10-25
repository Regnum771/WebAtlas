import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unit, type DictAttribute } from '@webatlas/shared';
import { useDictionary } from './useDictionary';
import { dictionaryKeyFor } from './layerKeys';
import { isCurrent } from './isCurrent';
import type { SheetRow } from '../ui/DictionarySheet.view';

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
    // Escape is the sheet's only while focus is in it, on its ⓘ, or nowhere: a menu, the search box
    // or a drawing tool also closes on Escape, and must not send the focus into the side panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const active = document.activeElement;
      const ours = active === null || active === document.body
        || active.closest('.dictionary-sheet') !== null
        || active.closest(`[data-dictionary-info="${CSS.escape(open.layerId)}"]`) !== null;
      if (ours) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const sheet = useMemo(() => {
    if (!open) return null;
    const key = dictionaryKeyFor(open.layerId);
    const featureType = key ? dictionary[key] : undefined;
    if (!key || !featureType) return null;
    return {
      title: `${open.layerName} — thuộc tính`,
      dictionaryKey: key,
      rows: featureType.attributes.filter((a) => isCurrent(a.validTo)).map(toRow),
    };
  }, [open, dictionary]);

  return { openLayerId: open?.layerId ?? null, sheet, openSheet, close };
}
