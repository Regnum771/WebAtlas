import { UNITS, sameDimension } from './units.js';
import type { DictAttribute, DictFeatureType, Dictionary } from './types.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const known = (code: string): boolean => Object.hasOwn(UNITS, code);

function checkPeriod(where: string, from: string, to: string | undefined, out: string[]): void {
  if (!DATE.test(from)) out.push(`${where}: validFrom "${from}" is not YYYY-MM-DD`);
  if (to !== undefined && !DATE.test(to)) out.push(`${where}: validTo "${to}" is not YYYY-MM-DD`);
  if (DATE.test(from) && to !== undefined && DATE.test(to) && from > to) {
    out.push(`${where}: validFrom ${from} is after validTo ${to}`);
  }
}

function checkAttribute(ft: DictFeatureType, a: DictAttribute, out: string[]): void {
  const where = `${ft.key}.${a.name}`;
  const units = [a.storedUnit, ...(a.displayUnits ?? []), a.displayUnit].filter(
    (u): u is string => u !== undefined,
  );

  if ((a.valueType === 'text' || a.valueType === 'date') && units.length > 0) {
    out.push(`${where}: a ${a.valueType} attribute must not have units`);
  }
  for (const u of units) if (!known(u)) out.push(`${where}: unknown unit ${u}`);

  if (a.storedUnit !== undefined && known(a.storedUnit)) {
    if (!a.displayUnits || a.displayUnits.length === 0) {
      out.push(`${where}: storedUnit ${a.storedUnit} has no displayUnits`);
    }
    for (const u of a.displayUnits ?? []) {
      if (known(u) && !sameDimension(a.storedUnit, u)) {
        out.push(`${where}: display unit ${u} has another dimension than ${a.storedUnit}`);
      }
    }
  }
  if (a.displayUnit !== undefined && !(a.displayUnits ?? []).includes(a.displayUnit)) {
    out.push(`${where}: displayUnit ${a.displayUnit} is not in displayUnits`);
  }

  const hasValues = (a.values?.length ?? 0) > 0;
  if (a.valueType === 'code') {
    if (!a.codeList) out.push(`${where}: a code attribute needs a codeList`);
    if (!hasValues) out.push(`${where}: a code attribute needs values`);
  } else if (a.codeList !== undefined || a.values !== undefined) {
    out.push(`${where}: codeList and values belong only to code attributes`);
  }
  const codes = new Set<string>();
  for (const v of a.values ?? []) {
    if (codes.has(v.code)) out.push(`${where}: duplicate value code ${v.code}`);
    codes.add(v.code);
  }

  if (a.precision !== undefined && !(Number.isInteger(a.precision) && a.precision >= 0 && a.precision <= 6)) {
    out.push(`${where}: precision ${a.precision} is outside 0-6`);
  }
  checkPeriod(where, a.validFrom, a.validTo, out);

  if (ft.kind === 'raster' && a.source !== 'band') {
    out.push(`${where}: a raster attribute must have source band`);
  }
  if (ft.kind === 'vector' && a.source === 'band') {
    out.push(`${where}: a vector attribute must not have source band`);
  }
}

/** Problems in English, one per entry; empty when the dictionary is valid. */
export function validateDictionary(dictionary: Dictionary): string[] {
  const out: string[] = [];
  for (const [recordKey, ft] of Object.entries(dictionary)) {
    if (ft.key !== recordKey) out.push(`${recordKey}: key "${ft.key}" does not match its record key`);
    if (ft.kind === 'vector' && !ft.geometryType) out.push(`${ft.key}: a vector needs geometryType`);
    if (ft.kind === 'raster' && ft.geometryType) out.push(`${ft.key}: a raster must not have geometryType`);
    if (ft.crs !== 4326 && ft.crs !== 3857) out.push(`${ft.key}: crs ${ft.crs} is not 4326 or 3857`);
    checkPeriod(ft.key, ft.validFrom, ft.validTo, out);

    const names = new Set<string>();
    for (const a of ft.attributes) {
      if (names.has(a.name)) out.push(`${ft.key}.${a.name}: duplicate attribute name`);
      names.add(a.name);
      checkAttribute(ft, a, out);
    }
  }
  return out;
}
