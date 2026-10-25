import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { DICTIONARY, UNITS, sameDimension, type DictAttribute, type DictFeatureType } from '@webatlas/shared';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import {
  attributeEditSchema, featureTypeEditSchema, historyQuerySchema, restoreSchema, storedUnitPreviewSchema,
  valueAddSchema, valueEditSchema, MESSAGES, type Entity,
} from './editSchemas';
import { getFeatureType, type RevisedAttribute, type RevisedFeatureType } from './service';
import { checkStoredUnit, latestUnitPeriod, previewStoredUnit, writeUnitPeriod, type PreviewRow } from './storedUnit';
import {
  ATTRIBUTE_COLUMNS, FEATURE_TYPE_COLUMNS, VALUE_COLUMNS, bumpAttributeRevision, fromColumns, insertValue, lockDictionary,
  todayInVietnam, updateRow, writeHistory,
} from './sync';
import {
  EDITABLE_FEATURE_TYPE_FIELDS, EDITABLE_VALUE_FIELDS, LOCKED_ATTRIBUTE_FIELDS, LOCKED_FEATURE_TYPE_FIELDS,
  LOCKED_VALUE_FIELDS, lockedAttributeFields, lockedValueFields,
  type Origin, type StoredAttribute, type StoredFeatureType, type StoredValue, type SyncTarget,
} from './syncPlan';

/*
 * The staff edit API (spec §2.2-2.4, Plan C Tasks 5-6). Every write runs in one transaction under
 * the sync's advisory lock: it checks the caller's revision, sets the fields, records who edited
 * them in `origin` (so the sync keeps them), bumps the revision and writes one history row per
 * field. Writes go through the sync's own updateRow, so field names reach SQL only through its
 * fixed column maps. A listed value has no revision of its own: its attribute's is checked and
 * bumped.
 */

/** The attribute fields this API edits; `valueType` only on an `extra` attribute (Ruling 5). */
const EDITED_ATTRIBUTE_FIELDS = [
  'label', 'definition', 'displayUnits', 'displayUnit', 'precision', 'cfStandardName', 'validTo', 'valueType',
] as const;

type Row<T> = T & { revision: number };

function refuse(message: string, field: string): ValidationError {
  return new ValidationError(message, { field });
}

/**
 * A field this API does not edit: locked by the data structure, or simply not offered. `entity`
 * names the field as that entity calls it (`name` is the layer's name, the column, or the value's).
 */
function notEditable(field: string, locked: readonly string[], entity: Entity): ValidationError {
  if (field === 'valueType') return refuse(MESSAGES.valueType, field);
  return refuse(locked.includes(field) ? MESSAGES.locked(field, entity) : MESSAGES.unknownField(field, entity), field);
}

/**
 * Parses a body; the first problem is refused in Vietnamese with `details: { field }`. A key the
 * schema does not know is reported first, as locked or not offered.
 */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown, locked: readonly string[], entity: Entity = 'featureType'): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues;
  for (const i of issues) if (i.code === 'unrecognized_keys') throw notEditable(i.keys[0]!, locked, entity);
  const issue = issues[0]!;
  const field = issue.path[0];
  throw new ValidationError(issue.message, typeof field === 'string' ? { field } : undefined);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Dates are read as text: node-pg would turn a date into a local-midnight Date.
const DATES = 'valid_from::text AS valid_from, valid_to::text AS valid_to';

/** One feature type row, locked for the transaction, keyed by shared field names. */
async function readFeatureType(q: PoolClient, key: string): Promise<Row<StoredFeatureType> | null> {
  const { rows } = await q.query(
    `SELECT key, kind, name, definition, table_name, crs, geometry_type, geometry_meaning, ${DATES}, origin, revision
       FROM app.dictionary_feature_types WHERE key = $1 FOR UPDATE`, [key]);
  if (rows.length === 0) return null;
  return { ...fromColumns<StoredFeatureType>(rows[0], FEATURE_TYPE_COLUMNS, { key: 'key' }), revision: rows[0].revision };
}

/** One attribute row, locked for the transaction, keyed by shared field names. */
async function readAttribute(q: PoolClient, key: string, name: string): Promise<Row<StoredAttribute> | null> {
  const { rows } = await q.query(
    `SELECT feature_type, name, ord, source, value_type, label, definition, stored_unit, display_units, display_unit,
            precision, cf_standard_name, code_list, nodata, scale, value_offset, ${DATES}, origin, revision
       FROM app.dictionary_attributes WHERE feature_type = $1 AND name = $2 FOR UPDATE`, [key, name]);
  if (rows.length === 0) return null;
  const row = fromColumns<StoredAttribute>(rows[0], ATTRIBUTE_COLUMNS, { featureType: 'feature_type', name: 'name' });
  return { ...row, revision: rows[0].revision };
}

const layerMissing = (layer: string) => new NotFoundError(`Không có lớp "${layer}" trong từ điển dữ liệu.`);
const attributeMissing = (layer: string, attribute: string) =>
  new NotFoundError(`Không có thuộc tính "${attribute}" của lớp "${layer}" trong từ điển dữ liệu.`);

/** The stored row of a target, or 404. */
async function readTarget(q: PoolClient, t: SyncTarget): Promise<Row<StoredFeatureType> | Row<StoredAttribute>> {
  if (t.attribute === undefined) {
    const row = await readFeatureType(q, t.featureType);
    if (!row) throw layerMissing(t.featureType);
    return row;
  }
  const row = await readAttribute(q, t.featureType, t.attribute);
  if (!row) {
    if (!(await readFeatureType(q, t.featureType))) throw layerMissing(t.featureType);
    throw attributeMissing(t.featureType, t.attribute);
  }
  return row;
}

/** One listed value, locked for the transaction, keyed by shared field names. */
async function readValue(q: PoolClient, t: Required<SyncTarget>): Promise<StoredValue | null> {
  const { rows } = await q.query(
    `SELECT feature_type, attribute, code, name, definition, ord, retired, color_hint, origin
       FROM app.dictionary_values WHERE feature_type = $1 AND attribute = $2 AND code = $3 FOR UPDATE`,
    [t.featureType, t.attribute, t.code]);
  if (rows.length === 0) return null;
  return fromColumns<StoredValue>(rows[0], VALUE_COLUMNS, { featureType: 'feature_type', attribute: 'attribute', code: 'code' });
}

/** Runs `work` in one transaction under the dictionary lock, then serves the target as it now is. */
async function inTransaction<T>(pool: Pool, t: SyncTarget, work: (q: PoolClient) => Promise<void>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockDictionary(client);
    await work(client);
    const served = await serve(client, t);
    await client.query('COMMIT');
    return served as T;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The entry in the served shape plus `revision`: the layer, or one of its attributes. */
async function serve(q: PoolClient, t: SyncTarget): Promise<RevisedFeatureType | RevisedAttribute> {
  const layer = await getFeatureType(q, t.featureType);
  if (!layer) throw layerMissing(t.featureType);
  if (t.attribute === undefined) return layer;
  const attribute = layer.attributes.find((a) => a.name === t.attribute);
  if (!attribute) throw attributeMissing(t.featureType, t.attribute);
  return attribute;
}

function checkRevision(stored: { revision: number }, expected: number) {
  if (stored.revision !== expected) throw new AppError(409, 'DICTIONARY_CHANGED', MESSAGES.changed);
}

function checkValidTo(validTo: string | null | undefined, validFrom: string) {
  if (typeof validTo === 'string' && validTo < validFrom) throw refuse(MESSAGES.validTo, 'validTo');
}

/** Spec §2.2's rules that need the stored attribute (the shapes are checked by the schema). */
function checkAttribute(stored: StoredAttribute, edit: z.output<typeof attributeEditSchema>) {
  if (edit.valueType !== undefined && stored.source !== 'extra') throw refuse(MESSAGES.valueType, 'valueType');
  const storedUnit = stored.storedUnit;
  if (edit.displayUnits !== undefined) {
    const permitted = storedUnit !== undefined
      && edit.displayUnits.every((u) => Object.hasOwn(UNITS, u) && sameDimension(u, storedUnit));
    if (!permitted) throw refuse(MESSAGES.displayUnits, 'displayUnits');
  }
  const units = edit.displayUnits ?? stored.displayUnits;
  if (edit.displayUnit !== undefined && !units.includes(edit.displayUnit)) throw refuse(MESSAGES.displayUnit, 'displayUnit');
  // A new list must keep the unit shown (the sync would revert it otherwise).
  const shown = edit.displayUnit ?? stored.displayUnit;
  if (edit.displayUnits !== undefined && shown !== undefined && !units.includes(shown)) {
    throw refuse(MESSAGES.displayUnitsKeepShown, 'displayUnits');
  }
  checkValidTo(edit.validTo, stored.validFrom);
}

const originOf = (fields: string[], userId: string): Origin => {
  const at = new Date().toISOString();
  return Object.fromEntries(fields.map((f) => [f, { by: userId, at }]));
};

/**
 * Writes the fields of `edit` that change; nothing at all (no revision bump) when none does.
 * Returns the fields written.
 */
async function applyEdit(q: PoolClient, t: SyncTarget, stored: Record<string, unknown>, edit: Record<string, unknown>,
  userId: string): Promise<string[]> {
  const set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(edit)) {
    if (field !== 'expectedRevision' && value !== undefined && !same(stored[field], value)) set[field] = value;
  }
  const fields = Object.keys(set);
  if (fields.length === 0) return [];
  await updateRow(q, t, set, { add: originOf(fields, userId) });
  for (const [field, value] of Object.entries(set)) await writeHistory(q, t, field, stored[field], value, 'edit', userId);
  return fields;
}

/** PATCH /api/dictionary/:layer: name, definition, geometry meaning, validTo. */
export async function editFeatureType(pool: Pool, userId: string, layer: string, body: unknown): Promise<RevisedFeatureType> {
  const edit = parseBody(featureTypeEditSchema, body, LOCKED_FEATURE_TYPE_FIELDS);
  const t: SyncTarget = { featureType: layer };
  return inTransaction(pool, t, async (q) => {
    const stored = (await readTarget(q, t)) as Row<StoredFeatureType>;
    checkRevision(stored, edit.expectedRevision);
    checkValidTo(edit.validTo, stored.validFrom);
    await applyEdit(q, t, stored as unknown as Record<string, unknown>, edit, userId);
  });
}

/**
 * The stored-unit correction's date (Ruling 6): not before the attribute's validFrom, nor before
 * the last correction (the periods stay in date order; the same date replaces that correction).
 * It corrects a claim about data already stored, so it is not after today (in Vietnam) nor after
 * the attribute's validTo.
 */
async function checkStoredUnitValidFrom(q: PoolClient, t: SyncTarget, stored: StoredAttribute, validFrom: string) {
  const latest = await latestUnitPeriod(q, t);
  const tooEarly = validFrom < stored.validFrom || (latest !== null && validFrom < latest);
  const tooLate = validFrom > todayInVietnam() || (stored.validTo !== undefined && validFrom > stored.validTo);
  if (tooEarly || tooLate) throw refuse(MESSAGES.storedUnitValidFrom, 'storedUnitValidFrom');
}

/**
 * PATCH /api/dictionary/:layer/:attribute: wording, display units, precision, CF name, validTo,
 * and the stored-unit correction with the date it applies from.
 */
export async function editAttribute(pool: Pool, userId: string, layer: string, attribute: string, body: unknown): Promise<RevisedAttribute> {
  // valueType is in the schema: on a non-extra attribute it is refused once the row is read. The
  // attribute's `name` is its column (or key), set by the data structure.
  const { storedUnitValidFrom, ...edit } = parseBody(attributeEditSchema, body, [...LOCKED_ATTRIBUTE_FIELDS, 'name'], 'attribute');
  const t: SyncTarget = { featureType: layer, attribute };
  return inTransaction(pool, t, async (q) => {
    const stored = (await readTarget(q, t)) as Row<StoredAttribute>;
    checkRevision(stored, edit.expectedRevision);
    checkAttribute(stored, edit);
    // The schema sends the unit and its date together; an unchanged unit is no correction.
    const correcting = edit.storedUnit !== undefined && edit.storedUnit !== stored.storedUnit;
    if (correcting) {
      checkStoredUnit(stored.storedUnit, edit.storedUnit!);
      await checkStoredUnitValidFrom(q, t, stored, storedUnitValidFrom!);
    }
    const written = await applyEdit(q, t, stored as unknown as Record<string, unknown>, edit, userId);
    if (written.includes('storedUnit')) {
      await writeUnitPeriod(q, t, {
        previousUnit: stored.storedUnit!, unit: edit.storedUnit!, validFrom: storedUnitValidFrom!,
        attributeValidFrom: stored.validFrom, userId,
      });
    }
  });
}

/** The attribute of a listed-value request, locked, at the caller's revision, with a code list. */
async function readListAttribute(q: PoolClient, t: SyncTarget, expectedRevision: number): Promise<Row<StoredAttribute>> {
  const stored = (await readTarget(q, t)) as Row<StoredAttribute>;
  checkRevision(stored, expectedRevision);
  if (stored.codeList === undefined) throw new ValidationError(MESSAGES.noCodeList);
  return stored;
}

/**
 * POST /api/dictionary/:layer/:attribute/values: a code staff add to an open list. Its origin
 * carries `code` (so the sync keeps it while the list stays open), `name` and, when one is sent,
 * `definition` (so a later code default for the same code never overwrites the staff wording;
 * Ruling 4). Without a staff definition, a later code default's definition applies.
 */
export async function addValue(pool: Pool, userId: string, layer: string, attribute: string, body: unknown): Promise<RevisedAttribute> {
  const add = parseBody(valueAddSchema, body, [], 'value');
  const t: SyncTarget = { featureType: layer, attribute };
  return inTransaction(pool, t, async (q) => {
    const stored = await readListAttribute(q, t, add.expectedRevision);
    if (stored.codeList !== 'open') throw new ValidationError(MESSAGES.closedList);
    const target = { featureType: layer, attribute, code: add.code };
    if (await readValue(q, target)) throw refuse(MESSAGES.codeExists(add.code), 'code');
    const { rows } = await q.query<{ ord: number }>(
      `SELECT COALESCE(max(ord), 0) + 1 AS ord FROM app.dictionary_values WHERE feature_type = $1 AND attribute = $2`,
      [layer, attribute]);
    const value: StoredValue = {
      featureType: layer, attribute, code: add.code, name: add.name,
      ...(add.definition !== undefined ? { definition: add.definition } : {}),
      ord: rows[0]!.ord, retired: false,
      origin: originOf(['code', 'name', ...(add.definition !== undefined ? ['definition'] : [])], userId),
    };
    await insertValue(q, value);
    await bumpAttributeRevision(q, layer, attribute);
    await writeHistory(q, target, 'code', null, add.code, 'edit', userId);
    await writeHistory(q, target, 'name', null, add.name, 'edit', userId);
    if (add.definition !== undefined) await writeHistory(q, target, 'definition', null, add.definition, 'edit', userId);
  });
}

/** PATCH /api/dictionary/:layer/:attribute/values/:code: name, definition, colour hint, retired. */
export async function editValue(pool: Pool, userId: string, layer: string, attribute: string, code: string,
  body: unknown): Promise<RevisedAttribute> {
  const edit = parseBody(valueEditSchema, body, [...LOCKED_VALUE_FIELDS, 'code'], 'value');
  const t: SyncTarget = { featureType: layer, attribute };
  return inTransaction(pool, t, async (q) => {
    const stored = await readListAttribute(q, t, edit.expectedRevision);
    // In a closed list the code decides which codes are in use (the sync would revert it).
    if (edit.retired !== undefined && lockedValueFields(stored.codeList).includes('retired')) {
      throw refuse(MESSAGES.locked('retired', 'value'), 'retired');
    }
    const target = { featureType: layer, attribute, code };
    const value = await readValue(q, target);
    if (!value) throw new NotFoundError(`Không có giá trị "${code}" của thuộc tính "${attribute}" trong từ điển dữ liệu.`);
    await applyEdit(q, target, value as unknown as Record<string, unknown>, edit, userId);
  });
}

/** POST /api/dictionary/:layer/:attribute/stored-unit/preview */
export async function previewCorrection(pool: Pool, layer: string, attribute: string, body: unknown): Promise<{ rows: PreviewRow[] }> {
  const { storedUnit } = parseBody(storedUnitPreviewSchema, body, []);
  return previewStoredUnit(pool, layer, attribute, storedUnit);
}

/** The code defaults of a target's editable fields, as the sync would write them. */
function codeDefault(t: SyncTarget): Record<string, unknown> | null {
  const ft: DictFeatureType | undefined = Object.hasOwn(DICTIONARY, t.featureType) ? DICTIONARY[t.featureType] : undefined;
  if (!ft) return null;
  if (t.attribute === undefined) return ft as unknown as Record<string, unknown>;
  const a: DictAttribute | undefined = ft.attributes.find((x) => x.name === t.attribute);
  return a ? { ...a, displayUnits: a.displayUnits ?? [] } : null;
}

/**
 * Restoring one of the display unit and its permitted list can leave the other invalid (the
 * default unit outside an edited list, or an edited unit outside the default list); the sync would
 * revert it, so the restore takes it back too.
 */
function withCompanions(fields: Set<string>, stored: StoredAttribute, code: Record<string, unknown>): Set<string> {
  const units = (fields.has('displayUnits') ? code.displayUnits : stored.displayUnits) as string[];
  const shown = (fields.has('displayUnit') ? code.displayUnit : stored.displayUnit) as string | undefined;
  if (shown !== undefined && !units.includes(shown)) return new Set([...fields, 'displayUnit', 'displayUnits']);
  return fields;
}

/**
 * Puts `fields` of one stored row back to `code`, dropping their origin entries, with one history
 * row each (reason 'restore'). A field already at its default with no origin entry is left alone;
 * when no field changes, nothing is written (no revision bump).
 */
async function restoreRow(q: PoolClient, t: SyncTarget, stored: unknown, code: Record<string, unknown>, fields: Iterable<string>,
  userId: string): Promise<void> {
  const row = stored as Record<string, unknown> & { origin: Origin };
  const restored = [...fields].filter((f) => Object.hasOwn(row.origin, f) || !same(row[f], code[f]));
  if (restored.length === 0) return;
  const set = Object.fromEntries(restored.map((f) => [f, code[f]]));
  await updateRow(q, t, set, { drop: restored });
  for (const f of restored) await writeHistory(q, t, f, row[f], code[f], 'restore', userId);
}

/**
 * POST .../restore: the named fields go back to the CURRENT code default, and lose their origin.
 * Like a save, it quotes the revision the form was loaded at: a restore over someone else's newer
 * edit is refused (409), never applied silently.
 */
export async function restoreFields(pool: Pool, userId: string, t: SyncTarget, body: unknown): Promise<RevisedFeatureType | RevisedAttribute> {
  const entity: Entity = t.attribute === undefined ? 'featureType' : 'attribute';
  const { expectedRevision, fields: requested } = parseBody(restoreSchema, body, [], entity);
  return inTransaction(pool, t, async (q) => {
    const stored = await readTarget(q, t);
    checkRevision(stored, expectedRevision);
    let editable: readonly string[];
    let locked: readonly string[];
    if (t.attribute === undefined) {
      editable = EDITABLE_FEATURE_TYPE_FIELDS;
      locked = LOCKED_FEATURE_TYPE_FIELDS;
    } else {
      const source = (stored as StoredAttribute).source;
      locked = lockedAttributeFields(source);
      editable = EDITED_ATTRIBUTE_FIELDS.filter((f) => !locked.includes(f));
    }
    for (const field of requested) if (!editable.includes(field)) throw notEditable(field, locked, entity);

    const code = codeDefault(t);
    if (!code) throw new ValidationError(MESSAGES.noDefault);
    let fields = new Set(requested);
    if (t.attribute !== undefined) fields = withCompanions(fields, stored as StoredAttribute, code);
    await restoreRow(q, t, stored, code, fields, userId);
  });
}

/** The code default of one listed value's editable fields, as the sync writes them; null when the code has none. */
function valueCodeDefault(t: Required<SyncTarget>): Record<string, unknown> | null {
  const ft = Object.hasOwn(DICTIONARY, t.featureType) ? DICTIONARY[t.featureType] : undefined;
  const v = ft?.attributes.find((a) => a.name === t.attribute)?.values?.find((x) => x.code === t.code);
  if (!v) return null;
  return { name: v.name, definition: v.definition, colorHint: v.colorHint, retired: v.retired ?? false };
}

/**
 * POST /api/dictionary/:layer/:attribute/values/:code/restore: the named fields of one listed value
 * go back to the CURRENT code default (spec §2.3). The body quotes the attribute's revision, which
 * the restore bumps. A code staff added has no default: 400.
 */
export async function restoreValue(pool: Pool, userId: string, layer: string, attribute: string, code: string,
  body: unknown): Promise<RevisedAttribute> {
  const { expectedRevision, fields } = parseBody(restoreSchema, body, [], 'value');
  const t: SyncTarget = { featureType: layer, attribute };
  return inTransaction(pool, t, async (q) => {
    const stored = await readListAttribute(q, t, expectedRevision);
    const locked = lockedValueFields(stored.codeList);
    const editable: readonly string[] = EDITABLE_VALUE_FIELDS.filter((f) => !locked.includes(f));
    for (const field of fields) if (!editable.includes(field)) throw notEditable(field, [...locked, 'code'], 'value');
    const target = { featureType: layer, attribute, code };
    const value = await readValue(q, target);
    if (!value) throw new NotFoundError(`Không có giá trị "${code}" của thuộc tính "${attribute}" trong từ điển dữ liệu.`);
    const defaults = valueCodeDefault(target);
    if (!defaults) throw new ValidationError(MESSAGES.noValueDefault(code));
    await restoreRow(q, target, value, defaults, new Set(fields), userId);
  });
}

export interface HistoryEntry {
  id: number;
  featureType: string;
  attribute: string | null;
  code: string | null;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: 'edit' | 'restore' | 'sync_revert' | 'sync_retire';
  /** Null for the sync, or once the author's account is deleted. */
  changedBy: { id: string; name: string } | null;
  changedAt: string;
}

/** GET /api/dictionary/history: newest first, optionally of one layer or one attribute. */
export async function listHistory(pool: Pool, query: unknown): Promise<HistoryEntry[]> {
  const { layer, attribute, limit } = parseBody(historyQuerySchema, query, []);
  const { rows } = await pool.query(
    `SELECT h.id, h.feature_type, h.attribute, h.code, h.field, h.old_value, h.new_value, h.reason, h.changed_at,
            u.id AS user_id, COALESCE(NULLIF(u.full_name, ''), u.email) AS user_name
       FROM app.dictionary_history h
       LEFT JOIN app.users u ON u.id = h.changed_by
      WHERE ($1::text IS NULL OR h.feature_type = $1) AND ($2::text IS NULL OR h.attribute = $2)
      ORDER BY h.changed_at DESC, h.id DESC
      LIMIT $3`, [layer ?? null, attribute ?? null, limit]);
  return rows.map((r) => ({
    id: Number(r.id),
    featureType: r.feature_type,
    attribute: r.attribute,
    code: r.code,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    reason: r.reason,
    changedBy: r.user_id ? { id: r.user_id, name: r.user_name } : null,
    changedAt: (r.changed_at as Date).toISOString(),
  }));
}
