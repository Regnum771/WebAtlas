import type { Pool } from 'pg';
import { DICTIONARY, attributeOf, mergeDictionary, unit, type Dictionary } from '@webatlas/shared';
import { getDictionary } from '../../../dictionary/service';

export interface FieldLabel { label: string; unit?: string }

/**
 * Labels and stored-unit symbols for the columns present in a tool result. Values in results stay
 * in stored units, so the symbol is the stored unit's; the model converts while reporting.
 * Columns without a dictionary entry are omitted.
 */
export function fieldsFor(
  dictionary: Dictionary,
  layerKey: string,
  columns: readonly string[],
): Record<string, FieldLabel> {
  const fields: Record<string, FieldLabel> = {};
  for (const column of columns) {
    const attribute = attributeOf(dictionary, layerKey, column);
    if (!attribute) continue;
    fields[column] = {
      label: attribute.label,
      ...(attribute.storedUnit ? { unit: unit(attribute.storedUnit).symbol } : {}),
    };
  }
  return fields;
}

const TTL_MS = 60_000;
let cached: { at: number; value: Dictionary } | null = null;

/** For tests only: forget the cached dictionary. */
export function clearDictionaryCache(): void {
  cached = null;
}

/**
 * The served dictionary (merged over the code copy), cached per process for 60 s. It must be
 * given the application's normal pool: the assistant's SQL role has no access to the dictionary
 * tables by design. Any failure falls back to the code copy, which is not cached.
 */
export async function loadDictionary(pg: Pool): Promise<Dictionary> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const { featureTypes } = await getDictionary(pg);
    if (featureTypes.length === 0 || featureTypes.some((t) => typeof t.key !== 'string')) {
      return DICTIONARY;
    }
    const value = mergeDictionary(DICTIONARY, featureTypes);
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return DICTIONARY;
  }
}

/** The stored unit symbol of the DEM band, for elevation results ('m'). */
export async function elevationUnit(pg: Pool): Promise<string> {
  const band = attributeOf(await loadDictionary(pg), 'dem', '1');
  return band?.storedUnit ? unit(band.storedUnit).symbol : 'm';
}

/** `{ fields }` for a result that lists features of one layer, or nothing when no column is known. */
export async function fieldsPart(
  pg: Pool,
  layerKey: string,
  columns: readonly string[],
): Promise<{ fields: Record<string, FieldLabel> } | Record<string, never>> {
  const fields = fieldsFor(await loadDictionary(pg), layerKey, columns);
  return Object.keys(fields).length > 0 ? { fields } : {};
}
