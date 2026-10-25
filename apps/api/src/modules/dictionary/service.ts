import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DictAttribute, DictFeatureType, DictValue } from '@webatlas/shared';
import {
  listAttributes, listFeatureTypes, listValues,
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

/** An attribute as one layer serves it: the shared shape plus the editor's revision. */
export type RevisedAttribute = DictAttribute & { revision: number };
/** A feature type as one layer serves it (GET /api/dictionary/:layer and the edit answers). */
export type RevisedFeatureType = Omit<DictFeatureType, 'attributes'> & { revision: number; attributes: RevisedAttribute[] };

/**
 * Rebuilds the shared-type shapes from database rows (already ordered by `ord`). `revisions`
 * adds each entry's `revision`: one layer serves it, the full list does not (its ETag would
 * change with every edit anyway, and readers have no use for it).
 */
export function assemble(types: FeatureTypeRow[], attrs: AttributeRow[], values: ValueRow[]): DictFeatureType[];
export function assemble(types: FeatureTypeRow[], attrs: AttributeRow[], values: ValueRow[],
  opts: { revisions: true }): RevisedFeatureType[];
export function assemble(types: FeatureTypeRow[], attrs: AttributeRow[], values: ValueRow[],
  opts: { revisions?: boolean } = {}): DictFeatureType[] | RevisedFeatureType[] {
  const rev = (r: { revision: number }) => (opts.revisions ? { revision: r.revision } : {});
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
    ...rev(t),
    attributes: (attrsBy.get(t.key) ?? []).map((a) => ({
      ...toAttribute(a, valuesBy.get(`${t.key}|${a.name}`) ?? [], t.valid_to),
      ...rev(a),
    })),
  }));
}

/**
 * The dictionary version (the ETag): a hash of exactly the JSON the response sends, so a body and
 * its version always match, any change to the served content changes it, and a sync that changes
 * nothing leaves it (and every client's cache) as it was.
 */
export function dictionaryVersion(featureTypes: readonly DictFeatureType[]): string {
  return createHash('sha256').update(JSON.stringify(featureTypes)).digest('hex').slice(0, 32);
}

export async function getDictionary(q: Pool | PoolClient): Promise<{ version: string; featureTypes: DictFeatureType[] }> {
  const [types, attrs, values] = await Promise.all([listFeatureTypes(q), listAttributes(q), listValues(q)]);
  const featureTypes = assemble(types, attrs, values);
  return { version: dictionaryVersion(featureTypes), featureTypes };
}

/** One layer with its revisions. Sequential, so it can run on one client inside a transaction. */
export async function getFeatureType(q: Pool | PoolClient, key: string): Promise<RevisedFeatureType | null> {
  const types = await listFeatureTypes(q, key);
  if (types.length === 0) return null;
  const attrs = await listAttributes(q, key);
  const values = await listValues(q, key);
  return assemble(types, attrs, values, { revisions: true })[0] ?? null;
}
