import {
  UNITS,
  sameDimension,
  type DictAttribute,
  type DictFeatureType,
  type DictValue,
  type Dictionary,
} from '@webatlas/shared';

/*
 * The sync planner (spec §2.1): compares the code dictionary with the stored rows and decides
 * what to insert, update, retire and revert. Pure: no database, no clock.
 *
 * Field names are the shared types' names (`table`, `displayUnit`, `offset`), not the column
 * names; the applier maps them. `origin` maps an edited field name to who edited it and when; a
 * field without an origin entry holds the code default.
 */

export type Origin = Record<string, { by: string; at: string }>;

export interface StoredFeatureType extends Omit<DictFeatureType, 'attributes'> {
  origin: Origin;
}

export interface StoredAttribute extends Omit<DictAttribute, 'values' | 'displayUnits'> {
  featureType: string;
  /** The attribute's position in the code entry; written by the sync, never edited. */
  ord: number;
  /** Never absent in the database (default '{}'); a code entry without units stores []. */
  displayUnits: string[];
  origin: Origin;
}

export interface StoredValue extends Omit<DictValue, 'order' | 'retired'> {
  featureType: string;
  attribute: string;
  /** The value's declared `order` in the code entry (1-based); written by the sync, never edited. */
  ord: number;
  retired: boolean;
  /**
   * A value staff added to an open list carries an origin entry for `code` (Plan C writes it).
   * Such a value is kept while the list stays open, and retired as a revert once it closes.
   */
  origin: Origin;
}

export interface StoredState {
  featureTypes: StoredFeatureType[];
  attributes: StoredAttribute[];
  values: StoredValue[];
}

/** Which row: a feature type, one of its attributes, or one listed value of an attribute. */
export interface SyncTarget {
  featureType: string;
  attribute?: string;
  code?: string;
}

/** Fields that follow the code (no staff edit in the way), with their new values. */
export interface SyncUpdate extends SyncTarget {
  set: Record<string, unknown>;
  /**
   * Origin entries to remove with no change of value: a locked field whose stored value already
   * equals the code's. No history, not a revert.
   */
  clearOrigin?: string[];
}

/**
 * A row gone from code: `validTo` = today (feature types, attributes) or `retired` (values). The
 * applier also removes that field's origin entry, so a stale staff edit (an un-retire) cannot keep
 * the row retired once it returns to code.
 */
export interface SyncRetire extends SyncTarget {
  field: 'validTo' | 'retired';
  newValue: string | true;
}

/** A staff edit that the code no longer allows; it falls back to the code default. */
export interface SyncRevert extends SyncTarget {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface SyncPlan {
  inserts: StoredState;
  updates: SyncUpdate[];
  retires: SyncRetire[];
  reverts: SyncRevert[];
}

// Spec §2.2: locked fields are overwritten from code at every sync, edited or not. `validFrom` is
// the lifetime the code gives an entry; staff retire only through `validTo` (spec DD8).
export const LOCKED_FEATURE_TYPE_FIELDS = ['kind', 'table', 'crs', 'geometryType', 'validFrom'] as const;
/**
 * `source` always, the band packing `nodata`, `scale` and `offset` (they define what stored numbers
 * mean, spec DD8), `validFrom`, and `ord`, the sync's own bookkeeping (an attribute's position in
 * its code entry; a value's declared order). `valueType` is locked too unless the attribute is an
 * `extra` key (see lockedAttributeFields). The codes of a `closed` list are locked as well (see
 * lockedValueFields): values are added and retired to match the code, and a staff-added code in a
 * closed list is reverted. `storedUnit` is editable but guarded (Ruling 6): a staff correction is
 * kept only while it shares the code unit's dimension (see attributeCheck).
 */
export const LOCKED_ATTRIBUTE_FIELDS = ['source', 'nodata', 'scale', 'offset', 'validFrom', 'ord'] as const;
export const LOCKED_VALUE_FIELDS = ['ord'] as const;
/** In a closed list, whether a code is in use is set by the code too. */
export const CLOSED_LIST_LOCKED_VALUE_FIELDS = ['ord', 'retired'] as const;

// Everything else is editable: it follows the code until staff edit it.
export const EDITABLE_FEATURE_TYPE_FIELDS = ['name', 'definition', 'geometryMeaning', 'validTo'] as const;
export const EDITABLE_ATTRIBUTE_FIELDS = [
  'valueType', 'label', 'definition', 'storedUnit', 'displayUnits', 'displayUnit', 'precision', 'cfStandardName', 'codeList',
  'validTo',
] as const;
export const EDITABLE_VALUE_FIELDS = ['name', 'definition', 'retired', 'colorHint'] as const;

/** The locked fields of an attribute whose code entry has this source. */
export function lockedAttributeFields(source: DictAttribute['source']): readonly string[] {
  return source === 'extra' ? LOCKED_ATTRIBUTE_FIELDS : [...LOCKED_ATTRIBUTE_FIELDS, 'valueType'];
}

/** The locked fields of the listed values of an attribute whose code entry has this code list. */
export function lockedValueFields(codeList: DictAttribute['codeList']): readonly string[] {
  return codeList === 'closed' ? CLOSED_LIST_LOCKED_VALUE_FIELDS : LOCKED_VALUE_FIELDS;
}

const GEOMETRY_MEANINGS: readonly string[] = ['exact', 'approximate', 'representativePoint'];
const VALUE_TYPES: readonly string[] = ['text', 'number', 'date', 'code'];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function featureTypeRow(ft: DictFeatureType): StoredFeatureType {
  const { attributes: _attributes, ...rest } = ft;
  return { ...rest, origin: {} };
}

function attributeRow(featureType: string, a: DictAttribute, ord: number): StoredAttribute {
  const { values: _values, ...rest } = a;
  return { ...rest, featureType, ord, displayUnits: a.displayUnits ?? [], origin: {} };
}

/** A listed value's `ord` is its declared `order`, which the API serves back as `order`. */
function valueRow(featureType: string, attribute: string, v: DictValue): StoredValue {
  const { order, ...rest } = v;
  return { ...rest, featureType, attribute, ord: order, retired: v.retired ?? false, origin: {} };
}

type Row = Record<string, unknown> & { origin: Origin };
/** The first edited field the code no longer allows, given the row as resolved so far. */
type Check = (resolved: Row, edited: ReadonlySet<string>) => string | undefined;

/**
 * Compares one stored row with its code default:
 * - a locked field takes the code value; a staff edit on it is reverted (with history), or only
 *   has its origin entry cleared when its value already equals the code's;
 * - an editable field without an edit takes the code value;
 * - an edited field is kept, unless `check` finds it invalid under the new code: then reverted.
 */
function reconcile(
  target: SyncTarget,
  stored: Row,
  code: Row,
  locked: readonly string[],
  editable: readonly string[],
  check: Check | undefined,
  plan: SyncPlan,
): void {
  const set: Record<string, unknown> = {};
  const clearOrigin: string[] = [];
  const reverts: SyncRevert[] = [];
  const revert = (field: string) => reverts.push({ ...target, field, oldValue: stored[field], newValue: code[field] });

  for (const field of locked) {
    const differs = !same(stored[field], code[field]);
    if (Object.hasOwn(stored.origin, field)) {
      if (differs) revert(field);
      else clearOrigin.push(field);
    } else if (differs) set[field] = code[field];
  }

  const edited = new Set(editable.filter((field) => Object.hasOwn(stored.origin, field)));
  const resolved: Row = { origin: {} };
  for (const field of editable) {
    resolved[field] = edited.has(field) ? stored[field] : code[field];
    if (!edited.has(field) && !same(stored[field], code[field])) set[field] = code[field];
  }
  // One invalid edit at a time: reverting one can make another invalid (a display unit checked
  // against a display-unit list that was itself reverted).
  for (let problem = check?.(resolved, edited); problem; problem = check?.(resolved, edited)) {
    revert(problem);
    edited.delete(problem);
    resolved[problem] = code[problem];
  }

  if (clearOrigin.length > 0) plan.updates.push({ ...target, set, clearOrigin });
  else if (Object.keys(set).length > 0) plan.updates.push({ ...target, set });
  plan.reverts.push(...reverts);
}

function checkFeatureType(resolved: Row, edited: ReadonlySet<string>) {
  return edited.has('geometryMeaning') && !GEOMETRY_MEANINGS.includes(resolved.geometryMeaning as string)
    ? 'geometryMeaning'
    : undefined;
}

/** The validity rules for edited attribute fields under the new code entry `code`. */
function attributeCheck(code: StoredAttribute): Check {
  const known = (u: string) => Object.hasOwn(UNITS, u);
  return (resolved, edited) => {
    const units = resolved.displayUnits as string[];
    const shown = resolved.displayUnit as string | undefined;

    if (edited.has('valueType') && !VALUE_TYPES.includes(resolved.valueType as string)) return 'valueType';
    // A corrected stored unit stays while it shares the code unit's dimension (Ruling 6); a code
    // entry without a stored unit, or with one of another dimension, takes it back.
    if (edited.has('storedUnit')) {
      const corrected = resolved.storedUnit;
      const codeUnit = code.storedUnit;
      const kept = typeof corrected === 'string' && codeUnit !== undefined && known(corrected) && known(codeUnit)
        && sameDimension(corrected, codeUnit);
      if (!kept) return 'storedUnit';
    }
    // Permitted display units: none without a stored unit; otherwise known units of its dimension.
    if (edited.has('displayUnits')) {
      const storedUnit = code.storedUnit;
      const permitted = storedUnit === undefined
        ? units.length === 0
        : units.length > 0 && units.every((u) => known(u) && sameDimension(u, storedUnit));
      if (!permitted) return 'displayUnits';
    }
    // The display unit shown must be a permitted one.
    if (edited.has('displayUnit') && shown !== undefined && !units.includes(shown)) return 'displayUnit';
    // An edited list must still contain the unit shown (the code default when that is not edited).
    if (edited.has('displayUnits') && shown !== undefined && !units.includes(shown)) return 'displayUnits';
    if (edited.has('precision') && resolved.precision !== undefined) {
      const p = resolved.precision as number;
      if (!Number.isInteger(p) || p < 0 || p > 6) return 'precision';
    }
    // An edit cannot open a closed list, nor give a code list to an attribute that has none.
    if (edited.has('codeList')) {
      if (code.codeList === undefined ? resolved.codeList !== undefined : code.codeList === 'closed' && resolved.codeList !== 'closed') {
        return 'codeList';
      }
    }
    return undefined;
  };
}

const keyOf = (...parts: string[]) => parts.join('\u0000');

/** Spec §2.1. `today` is YYYY-MM-DD, the `validTo` given to entries removed from code. */
export function planSync(defaults: Dictionary, stored: StoredState, today: string): SyncPlan {
  const plan: SyncPlan = { inserts: { featureTypes: [], attributes: [], values: [] }, updates: [], retires: [], reverts: [] };

  const storedFeatureTypes = new Map(stored.featureTypes.map((f) => [f.key, f]));
  const storedAttributes = new Map<string, StoredAttribute[]>();
  for (const a of stored.attributes) {
    const list = storedAttributes.get(a.featureType) ?? [];
    list.push(a);
    storedAttributes.set(a.featureType, list);
  }
  const storedValues = new Map<string, StoredValue[]>();
  for (const v of stored.values) {
    const k = keyOf(v.featureType, v.attribute);
    const list = storedValues.get(k) ?? [];
    list.push(v);
    storedValues.set(k, list);
  }

  for (const ft of Object.values(defaults)) {
    const codeFt = featureTypeRow(ft);
    const storedFt = storedFeatureTypes.get(ft.key);
    if (!storedFt) plan.inserts.featureTypes.push(codeFt);
    else {
      reconcile({ featureType: ft.key }, storedFt as unknown as Row, codeFt as unknown as Row,
        LOCKED_FEATURE_TYPE_FIELDS, EDITABLE_FEATURE_TYPE_FIELDS, checkFeatureType, plan);
    }

    const attributesOfFt = new Map((storedAttributes.get(ft.key) ?? []).map((a) => [a.name, a]));
    ft.attributes.forEach((a, ord) => {
      const codeAttr = attributeRow(ft.key, a, ord);
      const storedAttr = attributesOfFt.get(a.name);
      attributesOfFt.delete(a.name);
      const locked = lockedAttributeFields(a.source);
      if (!storedAttr) plan.inserts.attributes.push(codeAttr);
      else {
        reconcile({ featureType: ft.key, attribute: a.name }, storedAttr as unknown as Row, codeAttr as unknown as Row,
          locked, EDITABLE_ATTRIBUTE_FIELDS.filter((f) => !locked.includes(f)), attributeCheck(codeAttr), plan);
      }

      const lockedValues = lockedValueFields(a.codeList);
      const valuesOfAttr = new Map((storedValues.get(keyOf(ft.key, a.name)) ?? []).map((v) => [v.code, v]));
      for (const v of a.values ?? []) {
        const codeValue = valueRow(ft.key, a.name, v);
        const storedValue = valuesOfAttr.get(v.code);
        valuesOfAttr.delete(v.code);
        if (!storedValue) plan.inserts.values.push(codeValue);
        else {
          reconcile({ featureType: ft.key, attribute: a.name, code: v.code }, storedValue as unknown as Row,
            codeValue as unknown as Row, lockedValues, EDITABLE_VALUE_FIELDS.filter((f) => !lockedValues.includes(f)),
            undefined, plan);
        }
      }
      // Stored values the code no longer lists.
      for (const v of valuesOfAttr.values()) {
        if (v.retired) continue;
        const target = { featureType: ft.key, attribute: a.name, code: v.code };
        const staffAdded = Object.hasOwn(v.origin, 'code');
        if (!staffAdded) plan.retires.push({ ...target, field: 'retired', newValue: true });
        else if (a.codeList !== 'open') {
          // A code added by staff is not allowed in a closed list.
          plan.reverts.push({ ...target, field: 'retired', oldValue: false, newValue: true });
        }
      }
    });
    // Stored attributes the code no longer has. Their listed values stay as they are.
    for (const a of attributesOfFt.values()) {
      if (a.validTo === undefined) plan.retires.push({ featureType: ft.key, attribute: a.name, field: 'validTo', newValue: today });
    }
  }
  // Stored feature types the code no longer has. Their attributes stay as they are.
  for (const f of stored.featureTypes) {
    if (!Object.hasOwn(defaults, f.key) && f.validTo === undefined) {
      plan.retires.push({ featureType: f.key, field: 'validTo', newValue: today });
    }
  }
  return plan;
}
