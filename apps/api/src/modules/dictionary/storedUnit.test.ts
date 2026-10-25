import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DICTIONARY, formatValue, type DictAttribute } from '@webatlas/shared';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { runSync } from './sync';
import { PREVIEW_SOURCES } from './storedUnit';

/*
 * The stored-unit correction (Plan C Task 6, Ruling 6) on dams.wattage_mw (stored in MW). afterEach
 * deletes the unit periods this suite's user wrote, drops the attribute's storedUnit origin and
 * syncs, so the stored unit is MW again; afterAll deletes the suite's history rows and its user.
 */

const app = buildApp();
const PW = 'dd-unit-pass-123';
const ADMIN = 'dd-unit-admin@webatlas.test';
const EMAILS = [ADMIN];
let adminId = '';

const LAYER = 'dams';
const ATTR = 'wattage_mw';
const URL = `/api/dictionary/${LAYER}/${ATTR}`;
const codeAttr = DICTIONARY[LAYER]!.attributes.find((a) => a.name === ATTR)!;

let token = '';
async function auth() {
  if (!token) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ADMIN, password: PW } });
    token = res.json().token as string;
  }
  return { authorization: `Bearer ${token}` };
}

async function resetAttribute() {
  const pg = getPool();
  await pg.query(
    `DELETE FROM app.dictionary_unit_periods WHERE feature_type = $1 AND attribute = $2
        AND created_by IN (SELECT id FROM app.users WHERE email = ANY($3))`, [LAYER, ATTR, EMAILS]);
  await pg.query(`UPDATE app.dictionary_attributes SET origin = origin - 'storedUnit' WHERE feature_type = $1 AND name = $2`,
    [LAYER, ATTR]);
  await runSync(pg, { dryRun: false });
}

async function cleanup() {
  const pg = getPool();
  await pg.query(
    `DELETE FROM app.dictionary_history WHERE changed_by IN (SELECT id FROM app.users WHERE email = ANY($1))`, [EMAILS]);
  await pg.query(`DELETE FROM app.users WHERE email = ANY($1)`, [EMAILS]);
}

beforeAll(async () => {
  await app.ready();
  await resetAttribute();
  await cleanup();
  const row = await usersRepository(getPool()).insert({ email: ADMIN, password_hash: await hashPassword(PW), full_name: ADMIN, role: 'admin' });
  adminId = row.id;
});

afterEach(async () => { await resetAttribute(); });

afterAll(async () => {
  await resetAttribute();
  await cleanup();
  await app.close();
});

type ServedAttribute = DictAttribute & { revision: number };

async function served(): Promise<ServedAttribute> {
  const res = await app.inject({ method: 'GET', url: `/api/dictionary/${LAYER}` });
  return (res.json().attributes as ServedAttribute[]).find((a) => a.name === ATTR)!;
}
async function periods() {
  const { rows } = await getPool().query(
    `SELECT stored_unit, valid_from::text AS valid_from, created_by FROM app.dictionary_unit_periods
      WHERE feature_type = $1 AND attribute = $2 ORDER BY valid_from`, [LAYER, ATTR]);
  return rows as { stored_unit: string; valid_from: string; created_by: string | null }[];
}

describe('the stored-unit correction', () => {
  it('the preview shows five real values before and after', async () => {
    const attr = await served();
    expect(attr.storedUnit).toBe('MW');
    const res = await app.inject({ method: 'POST', url: `${URL}/stored-unit/preview`, headers: await auth(), payload: { storedUnit: 'kW' } });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as { id: string; stored: number; before: string; after: string }[];
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.id)).size).toBe(5);

    const { rows: real } = await getPool().query(
      `SELECT id::text AS id, wattage_mw AS stored FROM water.dams_active WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    const byId = new Map(real.map((r) => [r.id as string, Number(r.stored)]));
    for (const row of rows) {
      expect(row.stored).toBe(byId.get(row.id));
      expect(row.before).toBe(formatValue(attr, row.stored));
      expect(row.after).toBe(formatValue({ ...attr, storedUnit: 'kW' }, row.stored));
    }
    // Read as kW and shown in MW, every value is a thousand times smaller.
    expect(rows.some((r) => r.before !== r.after)).toBe(true);
    // A preview writes nothing.
    expect((await served()).revision).toBe(attr.revision);
  });

  it('a stored-unit correction of another dimension is refused', async () => {
    const before = await served();
    const preview = await app.inject({ method: 'POST', url: `${URL}/stored-unit/preview`, headers: await auth(), payload: { storedUnit: 'm' } });
    expect(preview.statusCode).toBe(400);
    expect(preview.json().error.details).toEqual({ field: 'storedUnit' });
    const unknown = await app.inject({ method: 'POST', url: `${URL}/stored-unit/preview`, headers: await auth(), payload: { storedUnit: 'không-có' } });
    expect(unknown.statusCode).toBe(400);

    const cases: [Record<string, unknown>, string][] = [
      [{ storedUnit: 'm', storedUnitValidFrom: '2026-11-01' }, 'storedUnit'], // another dimension
      [{ storedUnit: 'không-có', storedUnitValidFrom: '2026-11-01' }, 'storedUnit'], // not a unit
      [{ storedUnit: 'kW' }, 'storedUnitValidFrom'], // no date
      [{ storedUnitValidFrom: '2026-11-01' }, 'storedUnit'], // no unit
      [{ storedUnit: 'kW', storedUnitValidFrom: '2026-02-30' }, 'storedUnitValidFrom'], // not a date
      [{ storedUnit: 'kW', storedUnitValidFrom: '2020-01-01' }, 'storedUnitValidFrom'], // before validFrom
    ];
    for (const [fields, field] of cases) {
      const res = await app.inject({ method: 'PATCH', url: URL, headers: await auth(), payload: { expectedRevision: before.revision, ...fields } });
      expect(res.statusCode, JSON.stringify(fields)).toBe(400);
      expect(res.json().error.details, JSON.stringify(fields)).toEqual({ field });
    }
    expect((await served())).toMatchObject({ storedUnit: 'MW', revision: before.revision });
    expect(await periods()).toEqual([]);
  });

  it('a stored-unit correction writes its period and survives a sync', async () => {
    const before = await served();
    const res = await app.inject({
      method: 'PATCH', url: URL, headers: await auth(),
      payload: { expectedRevision: before.revision, storedUnit: 'kW', storedUnitValidFrom: '2026-11-01' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedAttribute;
    expect(body).toMatchObject({ storedUnit: 'kW', displayUnits: codeAttr.displayUnits, displayUnit: codeAttr.displayUnit });
    expect(body.revision).toBe(before.revision + 1);
    expect(body).not.toHaveProperty('storedUnitValidFrom');

    // The unit in force until the correction, then the corrected one.
    expect(await periods()).toEqual([
      { stored_unit: 'MW', valid_from: codeAttr.validFrom, created_by: adminId },
      { stored_unit: 'kW', valid_from: '2026-11-01', created_by: adminId },
    ]);
    const history = await app.inject({
      method: 'GET', url: `/api/dictionary/history?layer=${LAYER}&attribute=${ATTR}&limit=1`, headers: await auth(),
    });
    expect(history.json().history[0]).toMatchObject({ field: 'storedUnit', oldValue: 'MW', newValue: 'kW', reason: 'edit' });

    // A later correction may not predate the last one.
    const earlier = await app.inject({
      method: 'PATCH', url: URL, headers: await auth(),
      payload: { expectedRevision: body.revision, storedUnit: 'MW', storedUnitValidFrom: '2026-10-30' },
    });
    expect(earlier.statusCode).toBe(400);
    expect(earlier.json().error.details).toEqual({ field: 'storedUnitValidFrom' });

    const counts = await runSync(getPool(), { dryRun: false });
    expect(counts.reverted).toBe(0);
    expect((await served()).storedUnit).toBe('kW');
  });
});

describe('the preview sources', () => {
  it('every vector column with a stored unit has a fixed preview source', async () => {
    const withUnits = Object.values(DICTIONARY)
      .filter((ft) => ft.kind === 'vector' && ft.table !== undefined)
      .filter((ft) => ft.attributes.some((a) => a.source === 'column' && a.storedUnit !== undefined));
    expect(withUnits.map((ft) => ft.key).filter((key) => !Object.hasOwn(PREVIEW_SOURCES, key))).toEqual([]);
    // Every source belongs to a vector entry of the dictionary.
    for (const key of Object.keys(PREVIEW_SOURCES)) expect(DICTIONARY[key]?.kind, key).toBe('vector');

    // Each source relation reads the entry's table (or its active view), and has its id column and
    // the stored-unit columns it is read for.
    for (const ft of withUnits) {
      const { relation, id } = PREVIEW_SOURCES[ft.key]!;
      expect([ft.table, `${ft.table}_active`]).toContain(relation);
      const [schema, name] = relation.split('.');
      const { rows } = await getPool().query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [schema, name]);
      const columns = new Set(rows.map((r) => r.column_name));
      const wanted = [id, ...ft.attributes.filter((a) => a.source === 'column' && a.storedUnit !== undefined).map((a) => a.name)];
      expect(wanted.filter((c) => !columns.has(c)), relation).toEqual([]);
    }
  });
});
