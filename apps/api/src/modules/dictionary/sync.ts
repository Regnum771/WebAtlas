import type pg from 'pg';
import { DICTIONARY, validateDictionary, type Dictionary } from '@webatlas/shared';
import {
  planSync,
  type Origin,
  type StoredAttribute,
  type StoredFeatureType,
  type StoredState,
  type StoredValue,
  type SyncPlan,
  type SyncTarget,
} from './syncPlan';

/*
 * The sync applier (spec §2.1): reads the dictionary tables, plans with planSync and applies the
 * plan in the caller's transaction, under a transaction-scoped advisory lock so two runs (atlas:up
 * and a manual run) never interleave (Ruling 13). Following-code updates write no history; reverts
 * and retires do (reasons sync_revert, sync_retire), with no author.
 */

export interface SyncCounts {
  added: number;
  updated: number;
  retired: number;
  reverted: number;
}

type Queryable = Pick<pg.PoolClient, 'query'>;

// Shared-type field name -> column, per table. Identity columns are handled separately.
const FEATURE_TYPE_COLUMNS: Record<string, string> = {
  kind: 'kind', name: 'name', definition: 'definition', table: 'table_name', crs: 'crs',
  geometryType: 'geometry_type', geometryMeaning: 'geometry_meaning', validFrom: 'valid_from', validTo: 'valid_to',
};
const ATTRIBUTE_COLUMNS: Record<string, string> = {
  ord: 'ord', source: 'source', valueType: 'value_type', label: 'label', definition: 'definition',
  storedUnit: 'stored_unit', displayUnits: 'display_units', displayUnit: 'display_unit', precision: 'precision',
  cfStandardName: 'cf_standard_name', codeList: 'code_list', nodata: 'nodata', scale: 'scale', offset: 'value_offset',
  validFrom: 'valid_from', validTo: 'valid_to',
};
const VALUE_COLUMNS: Record<string, string> = {
  ord: 'ord', name: 'name', definition: 'definition', retired: 'retired', colorHint: 'color_hint',
};

/** The current date in Vietnam, YYYY-MM-DD. */
export function todayInVietnam(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
}

/** A row as the planner sees it: NULL columns become absent keys. */
function fromColumns<T>(row: Record<string, unknown>, columns: Record<string, string>, identity: Record<string, string>): T {
  const out: Record<string, unknown> = {};
  for (const [field, column] of Object.entries({ ...identity, ...columns })) {
    if (row[column] !== null && row[column] !== undefined) out[field] = row[column];
  }
  out.origin = row.origin as Origin;
  return out as T;
}

// Dates are read as text: node-pg would turn a date into a local-midnight Date.
const DATES = 'valid_from::text AS valid_from, valid_to::text AS valid_to';

export async function readState(q: Queryable): Promise<StoredState> {
  const ft = await q.query(
    `SELECT key, kind, name, definition, table_name, crs, geometry_type, geometry_meaning, ${DATES}, origin
       FROM app.dictionary_feature_types`);
  const attrs = await q.query(
    `SELECT feature_type, name, ord, source, value_type, label, definition, stored_unit, display_units, display_unit,
            precision, cf_standard_name, code_list, nodata, scale, value_offset, ${DATES}, origin
       FROM app.dictionary_attributes`);
  const values = await q.query(
    `SELECT feature_type, attribute, code, name, definition, ord, retired, color_hint, origin FROM app.dictionary_values`);
  return {
    featureTypes: ft.rows.map((r) => fromColumns<StoredFeatureType>(r, FEATURE_TYPE_COLUMNS, { key: 'key' })),
    attributes: attrs.rows.map((r) => fromColumns<StoredAttribute>(r, ATTRIBUTE_COLUMNS, { featureType: 'feature_type', name: 'name' })),
    values: values.rows.map((r) => fromColumns<StoredValue>(r, VALUE_COLUMNS, { featureType: 'feature_type', attribute: 'attribute', code: 'code' })),
  };
}

/** Which table a target names, its column map, its key condition, and whether it has a revision. */
function locate(t: SyncTarget, firstParam: number) {
  const p = (i: number) => `$${firstParam + i}`;
  if (t.code !== undefined) {
    return {
      table: 'app.dictionary_values', columns: VALUE_COLUMNS, revision: false,
      where: `feature_type = ${p(0)} AND attribute = ${p(1)} AND code = ${p(2)}`, key: [t.featureType, t.attribute, t.code],
    };
  }
  if (t.attribute !== undefined) {
    return {
      table: 'app.dictionary_attributes', columns: ATTRIBUTE_COLUMNS, revision: true,
      where: `feature_type = ${p(0)} AND name = ${p(1)}`, key: [t.featureType, t.attribute],
    };
  }
  return { table: 'app.dictionary_feature_types', columns: FEATURE_TYPE_COLUMNS, revision: true, where: `key = ${p(0)}`, key: [t.featureType] };
}

/** displayUnits is NOT NULL (default '{}'); every other absent field is NULL. */
const toColumn = (field: string, value: unknown) => (value === undefined ? (field === 'displayUnits' ? [] : null) : value);

/**
 * Sets fields of one row, removes origin entries, and bumps the revision a stale editor form
 * checks (for a listed value, its attribute's).
 */
async function updateRow(q: Queryable, t: SyncTarget, set: Record<string, unknown>, dropOrigin: string[] = []): Promise<void> {
  const fields = Object.keys(set);
  const where = locate(t, fields.length + (dropOrigin.length > 0 ? 2 : 1));
  const assignments = fields.map((f, i) => `${where.columns[f]} = $${i + 1}`);
  const params: unknown[] = fields.map((f) => toColumn(f, set[f]));
  if (dropOrigin.length > 0) {
    assignments.push(`origin = origin - $${fields.length + 1}::text[]`);
    params.push(dropOrigin);
  }
  if (where.revision) assignments.push('revision = revision + 1');
  const result = await q.query(`UPDATE ${where.table} SET ${assignments.join(', ')} WHERE ${where.where}`, [...params, ...where.key]);
  if (result.rowCount !== 1) throw new Error(`dictionary sync: expected one row for ${JSON.stringify(t)}, updated ${result.rowCount}`);
  if (!where.revision) {
    await q.query(`UPDATE app.dictionary_attributes SET revision = revision + 1 WHERE feature_type = $1 AND name = $2`,
      [t.featureType, t.attribute]);
  }
}

async function writeHistory(q: Queryable, t: SyncTarget, field: string, oldValue: unknown, newValue: unknown,
  reason: 'sync_revert' | 'sync_retire'): Promise<void> {
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  await q.query(
    `INSERT INTO app.dictionary_history (feature_type, attribute, code, field, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [t.featureType, t.attribute ?? null, t.code ?? null, field, json(oldValue), json(newValue), reason]);
}

/** `sql` adds columns given as SQL expressions (synced_at = now()). */
async function insertRow(q: Queryable, table: string, identity: Record<string, unknown>, row: Record<string, unknown>,
  columns: Record<string, string>, sql: Record<string, string> = {}): Promise<void> {
  const params = [...Object.values(identity), ...Object.keys(columns).map((f) => toColumn(f, row[f]))];
  const names = [...Object.keys(identity), ...Object.values(columns), ...Object.keys(sql)];
  const exprs = [...params.map((_, i) => `$${i + 1}`), ...Object.values(sql)];
  await q.query(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${exprs.join(', ')})`, params);
}

export async function applyPlan(q: Queryable, plan: SyncPlan): Promise<void> {
  // Parents before children: values reference attributes, attributes reference feature types.
  for (const f of plan.inserts.featureTypes) {
    await insertRow(q, 'app.dictionary_feature_types', { key: f.key }, f as unknown as Record<string, unknown>, FEATURE_TYPE_COLUMNS, { synced_at: 'now()' });
  }
  for (const a of plan.inserts.attributes) {
    await insertRow(q, 'app.dictionary_attributes', { feature_type: a.featureType, name: a.name },
      a as unknown as Record<string, unknown>, ATTRIBUTE_COLUMNS);
  }
  for (const v of plan.inserts.values) {
    await insertRow(q, 'app.dictionary_values', { feature_type: v.featureType, attribute: v.attribute, code: v.code },
      v as unknown as Record<string, unknown>, VALUE_COLUMNS);
  }
  for (const u of plan.updates) await updateRow(q, u, u.set, u.clearOrigin);
  for (const r of plan.reverts) {
    await updateRow(q, r, { [r.field]: r.newValue }, [r.field]);
    await writeHistory(q, r, r.field, r.oldValue, r.newValue, 'sync_revert');
  }
  for (const r of plan.retires) {
    // A stale edit of the same field (a staff un-retire) must not outlive the retire.
    await updateRow(q, r, { [r.field]: r.newValue }, [r.field]);
    await writeHistory(q, r, r.field, r.field === 'retired' ? false : null, r.newValue, 'sync_retire');
  }
}

/**
 * One sync inside the caller's open transaction: takes the advisory lock (held until that
 * transaction ends), then reads, plans and applies. The state is read after the lock, so a run
 * that waited sees what the other run committed.
 */
export async function syncInTransaction(q: Queryable, defaults: Dictionary, today: string): Promise<SyncCounts> {
  await q.query(`SELECT pg_advisory_xact_lock(hashtext('dictionary_sync'))`);
  const plan = planSync(defaults, await readState(q), today);
  await applyPlan(q, plan);
  // The feature types the code still has were confirmed by this run.
  await q.query(`UPDATE app.dictionary_feature_types SET synced_at = now() WHERE key = ANY($1)`, [Object.keys(defaults)]);
  return {
    added: plan.inserts.featureTypes.length + plan.inserts.attributes.length + plan.inserts.values.length,
    updated: plan.updates.length,
    retired: plan.retires.length,
    reverted: plan.reverts.length,
  };
}

/**
 * Syncs the code dictionary into the database in one transaction. `dryRun` plans and applies,
 * then rolls back, so the counts are exactly what a real run would do. `defaults` is for tests.
 */
export async function runSync(
  pool: pg.Pool,
  opts: { dryRun: boolean; today?: string; defaults?: Dictionary },
): Promise<SyncCounts> {
  const defaults = opts.defaults ?? DICTIONARY;
  const problems = validateDictionary(defaults);
  if (problems.length > 0) throw new Error(`dictionary sync: the code dictionary is invalid:\n${problems.join('\n')}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = await syncInTransaction(client, defaults, opts.today ?? todayInVietnam());
    await client.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
