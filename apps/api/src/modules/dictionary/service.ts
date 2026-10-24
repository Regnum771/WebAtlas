import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { DictAttribute, DictFeatureType, DictValue } from '@webatlas/shared';
import {
  listAttributes, listFeatureTypes, listValues, versionParts,
  type AttributeRow, type FeatureTypeRow, type ValueRow,
} from './repository';

/** `{ key: value }` unless value is null, so an absent field stays absent (never `null`). */
function opt<K extends string, V>(key: K, value: V | null): { [P in K]?: V } {
  return value === null || value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function toValue(r: ValueRow): DictValue {
  return {
    code: r.code, name: r.name, ...opt('definition', r.definition), order: r.ord,
    ...(r.retired ? { retired: true } : {}), ...opt('colorHint', r.color_hint),
  };
}

function toAttribute(r: AttributeRow, values: ValueRow[], parentValidTo: string | null): DictAttribute {
  // A retired parent retires its attributes: a reader that checks only the attribute sees it too.
  const validTo = r.valid_to ?? parentValidTo;
  return {
    name: r.name,
    source: r.source as DictAttribute['source'],
    valueType: r.value_type as DictAttribute['valueType'],
    label: r.label,
    definition: r.definition,
    ...opt('storedUnit', r.stored_unit),
    ...(r.display_units.length > 0 ? { displayUnits: r.display_units } : {}),
    ...opt('displayUnit', r.display_unit),
    ...opt('precision', r.precision),
    ...opt('cfStandardName', r.cf_standard_name),
    ...opt('codeList', r.code_list as 'closed' | 'open' | null),
    ...(values.length > 0 ? { values: values.map(toValue) } : {}),
    ...opt('nodata', r.nodata),
    ...opt('scale', r.scale),
    ...opt('offset', r.value_offset),
    validFrom: r.valid_from,
    ...opt('validTo', validTo),
  };
}

/** Rebuilds the shared-type shapes from database rows (already ordered by `ord`). */
export function assemble(types: FeatureTypeRow[], attrs: AttributeRow[], values: ValueRow[]): DictFeatureType[] {
  const valuesBy = new Map<string, ValueRow[]>();
  for (const v of values) {
    const k = `${v.feature_type}|${v.attribute}`;
    const list = valuesBy.get(k) ?? [];
    list.push(v);
    valuesBy.set(k, list);
  }
  const attrsBy = new Map<string, AttributeRow[]>();
  for (const a of attrs) {
    const list = attrsBy.get(a.feature_type) ?? [];
    list.push(a);
    attrsBy.set(a.feature_type, list);
  }

  return types.map((t) => ({
    key: t.key,
    kind: t.kind,
    name: t.name,
    definition: t.definition,
    ...opt('table', t.table_name),
    crs: t.crs,
    ...opt('geometryType', t.geometry_type as DictFeatureType['geometryType'] | null),
    geometryMeaning: t.geometry_meaning as DictFeatureType['geometryMeaning'],
    validFrom: t.valid_from,
    ...opt('validTo', t.valid_to),
    attributes: (attrsBy.get(t.key) ?? []).map((a) =>
      toAttribute(a, valuesBy.get(`${t.key}|${a.name}`) ?? [], t.valid_to)),
  }));
}

export async function getDictionary(pool: Pool): Promise<{ version: string; featureTypes: DictFeatureType[] }> {
  const [parts, types, attrs, values] = await Promise.all([
    versionParts(pool), listFeatureTypes(pool), listAttributes(pool), listValues(pool),
  ]);
  return {
    version: createHash('sha256').update(parts).digest('hex').slice(0, 32),
    featureTypes: assemble(types, attrs, values),
  };
}

export async function getFeatureType(pool: Pool, key: string): Promise<DictFeatureType | null> {
  const [types, attrs, values] = await Promise.all([
    listFeatureTypes(pool, key), listAttributes(pool, key), listValues(pool, key),
  ]);
  return assemble(types, attrs, values)[0] ?? null;
}
