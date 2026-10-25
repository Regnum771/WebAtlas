import { useState } from 'react';
import { unit, unitsOfDimension } from '@webatlas/shared';
import { patchAttribute, previewStoredUnit, type RevisedAttribute, type StoredUnitPreviewRow } from '../api/dictionaryEdit.api';
import type { StoredUnitView } from '../ui/StoredUnitDialog.view';
import { describeFailure } from './saveFeedback';

interface Preview { unit: string; rows: StoredUnitPreviewRow[] }

const symbolOf = (code: string) => {
  try { return unit(code).symbol; } catch { return code; }
};

/** Units of the same dimension as the stored unit; none when the unit is unknown. */
export function sameDimensionUnits(storedUnit: string): { value: string; label: string }[] {
  try {
    return unitsOfDimension(unit(storedUnit).dimension).map((u) => ({ value: u.code, label: u.symbol }));
  } catch {
    return [];
  }
}

/**
 * The stored-unit correction dialog of a number attribute (Ruling 6). The correction only changes how the
 * stored numbers are read; applying needs a preview of the chosen unit, a start date and the confirmation.
 */
export function useStoredUnitCorrection(
  layerKey: string,
  attribute: RevisedAttribute | undefined,
  reload: () => Promise<unknown>,
): { view: StoredUnitView | null; open: (() => void) | null } {
  // The dialog belongs to one attribute: choosing another closes it.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [date, setDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<{ message: string | null; errors: Record<string, string> } | null>(null);

  if (!attribute || attribute.valueType !== 'number' || !attribute.storedUnit) return { view: null, open: null };
  const stored = attribute.storedUnit;
  const key = `${layerKey}|${attribute.name}`;
  const units = sameDimensionUnits(stored);
  const selected = chosen ?? stored;

  const reset = () => {
    setChosen(null); setPreview(null); setPreviewing(false); setDate(''); setConfirmed(false); setApplying(false); setFailure(null);
  };
  const close = () => { setOpenFor(null); reset(); };
  const previewed = preview !== null && preview.unit === selected;
  const canApply = previewed && date !== '' && confirmed && !applying;

  const clearError = (field: string) => setFailure((prev) => {
    if (!prev || !(field in prev.errors)) return prev;
    const { [field]: _gone, ...rest } = prev.errors;
    return { ...prev, errors: rest };
  });

  async function runPreview() {
    setPreviewing(true);
    setFailure(null);
    try {
      const { rows } = await previewStoredUnit(layerKey, attribute!.name, selected);
      setPreview({ unit: selected, rows });
    } catch (e) {
      setFailure({ message: describeFailure(e).message, errors: describeFailure(e).errors });
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    setApplying(true);
    setFailure(null);
    try {
      await patchAttribute(layerKey, attribute!.name, {
        expectedRevision: attribute!.revision, storedUnit: selected, storedUnitValidFrom: date,
      });
      close();
      await reload();
    } catch (e) {
      const f = describeFailure(e);
      setFailure({ message: f.message, errors: f.errors });
      if (f.conflict) await reload();
    } finally {
      setApplying(false);
    }
  }

  const view: StoredUnitView = {
    open: openFor === key,
    attributeLabel: attribute.label,
    currentSymbol: symbolOf(stored),
    unit: selected,
    units,
    onUnit: (code) => { setChosen(code); clearError('storedUnit'); },
    canPreview: selected !== stored && !previewing,
    previewing,
    onPreview: () => { void runPreview(); },
    preview: previewed
      ? preview.rows.map((r) => ({ id: r.id, stored: String(r.stored), before: r.before, after: r.after }))
      : null,
    date,
    onDate: (value) => { setDate(value); clearError('storedUnitValidFrom'); },
    confirmed,
    onConfirmed: setConfirmed,
    canApply,
    applying,
    message: failure?.message ?? null,
    errors: failure?.errors ?? {},
    onApply: () => { if (canApply) void apply(); },
    onClose: close,
  };
  return { view, open: () => { reset(); setOpenFor(key); } };
}
