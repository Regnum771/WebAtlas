import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { DICTIONARY, UNITS, sameDimension, type DictAttribute, type DictFeatureType } from '@webatlas/shared';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import {
  attributeEditSchema, featureTypeEditSchema, historyQuerySchema, restoreSchema, MESSAGES,
} from './editSchemas';
import { getFeatureType, type RevisedAttribute, type RevisedFeatureType } from './service';
import { ATTRIBUTE_COLUMNS, FEATURE_TYPE_COLUMNS, fromColumns, locate, lockDictionary, toColumn, writeHistory } from './sync';
import {
  EDITABLE_FEATURE_TYPE_FIELDS, LOCKED_ATTRIBUTE_FIELDS, LOCKED_FEATURE_TYPE_FIELDS, lockedAttributeFields,
  type Origin, type StoredAttribute, type StoredFeatureType, type SyncTarget,
} from './syncPlan';

/*
 * The staff edit API (spec §2.2-2.4, Plan C Task 5). Every write runs in one transaction under the
 * sync's advisory lock: it checks the caller's revision, sets the fields, records who edited them
 * in `origin` (so the sync keeps them), bumps the revision and writes one history row per field.
 * Field names reach SQL only through the sync's fixed column maps.
 */

/** The attribute fields this API edits; `valueType` only on an `extra` attribute (Ruling 5). */
const EDITED_ATTRIBUTE_FIELDS = [
  'label', 'definition', 'displayUnits', 'displayUnit', 'precision', 'cfStandardName', 'validTo', 'valueType',
] as const;

type Row<T> = T & { revision: number };

function refuse(message: string, field: string): ValidationError {
  return new ValidationError(message, { field });
}

/** A field this API does not edit: locked by the data structure, or simply not offered. */
function notEditable(field: string, locked: readonly string[]): ValidationError {
  if (field === 'valueType') return refuse(MESSAGES.valueType, field);
  return refuse(locked.includes(field) ? MESSAGES.locked(field) : MESSAGES.unknownField(field), field);
}

/**
 * Parses a body; the first problem is refused in Vietnamese with `details: { field }`. A key the
 * schema does not know is reported first, as locked or not offered.
 */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown, locked: readonly string[]): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues;
  for (const i of issues) if (i.code === 'unrecognized_keys') throw notEditable(i.keys[0]!, locked);
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

/**
 * Sets `set` on one row, drops `dropOrigin` and merges `addOrigin` into its origin, and bumps its
 * revision. Columns come from the sync's fixed maps; every value is bound.
 */
async function writeRow(q: PoolClient, t: SyncTarget, set: Record<string, unknown>, origin: { add?: Origin; drop?: string[] }) {
  const fields = Object.keys(set);
  const params: unknown[] = fields.map((f) => toColumn(f, set[f]));
  let originExpr = 'origin';
  if (origin.drop && origin.drop.length > 0) {
    params.push(origin.drop);
    originExpr = `(${originExpr} - $${params.length}::text[])`;
  }
  if (origin.add) {
    params.push(JSON.stringify(origin.add));
    originExpr = `(${originExpr} || $${params.length}::jsonb)`;
  }
  const where = locate(t, params.length + 1);
  const assignments = [...fields.map((f, i) => `${where.columns[f]} = $${i + 1}`), `origin = ${originExpr}`, 'revision = revision + 1'];
  await q.query(`UPDATE ${where.table} SET ${assignments.join(', ')} WHERE ${where.where}`, [...params, ...where.key]);
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

/** Writes the fields of `edit` that change; nothing at all (no revision bump) when none does. */
async function applyEdit(q: PoolClient, t: SyncTarget, stored: Record<string, unknown>, edit: Record<string, unknown>, userId: string) {
  const set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(edit)) {
    if (field !== 'expectedRevision' && value !== undefined && !same(stored[field], value)) set[field] = value;
  }
  if (Object.keys(set).length === 0) return;
  const at = new Date().toISOString();
  const add: Origin = Object.fromEntries(Object.keys(set).map((f) => [f, { by: userId, at }]));
  await writeRow(q, t, set, { add });
  for (const [field, value] of Object.entries(set)) await writeHistory(q, t, field, stored[field], value, 'edit', userId);
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

/** PATCH /api/dictionary/:layer/:attribute: wording, display units, precision, CF name, validTo. */
export async function editAttribute(pool: Pool, userId: string, layer: string, attribute: string, body: unknown): Promise<RevisedAttribute> {
  // valueType is in the schema: on a non-extra attribute it is refused once the row is read.
  const edit = parseBody(attributeEditSchema, body, LOCKED_ATTRIBUTE_FIELDS);
  const t: SyncTarget = { featureType: layer, attribute };
  return inTransaction(pool, t, async (q) => {
    const stored = (await readTarget(q, t)) as Row<StoredAttribute>;
    checkRevision(stored, edit.expectedRevision);
    checkAttribute(stored, edit);
    await applyEdit(q, t, stored as unknown as Record<string, unknown>, edit, userId);
  });
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

/** POST .../restore: the named fields go back to the CURRENT code default, and lose their origin. */
export async function restoreFields(pool: Pool, userId: string, t: SyncTarget, body: unknown): Promise<RevisedFeatureType | RevisedAttribute> {
  const { fields: requested } = parseBody(restoreSchema, body, []);
  return inTransaction(pool, t, async (q) => {
    const stored = await readTarget(q, t);
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
    for (const field of requested) if (!editable.includes(field)) throw notEditable(field, locked);

    const code = codeDefault(t);
    if (!code) throw new ValidationError(MESSAGES.noDefault);
    let fields = new Set(requested);
    if (t.attribute !== undefined) fields = withCompanions(fields, stored as StoredAttribute, code);

    const row = stored as unknown as Record<string, unknown> & { origin: Origin };
    const restored = [...fields].filter((f) => Object.hasOwn(row.origin, f) || !same(row[f], code[f]));
    if (restored.length === 0) return;
    const set = Object.fromEntries(restored.map((f) => [f, code[f]]));
    await writeRow(q, t, set, { drop: restored });
    for (const f of restored) await writeHistory(q, t, f, row[f], code[f], 'restore', userId);
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
