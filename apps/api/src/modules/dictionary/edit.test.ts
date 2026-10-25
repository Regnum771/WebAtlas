import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DICTIONARY } from '@webatlas/shared';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { runSync } from './sync';

/*
 * The staff edit API (Plan C Task 5). Every test edits lakes / lakes.volume_mcm through the API;
 * afterEach drops the origin entries of the fields this suite edits and syncs, so each test starts
 * from the code defaults and the dev database's dictionary ends unchanged.
 */

const app = buildApp();
const PW = 'dd-edit-pass-123';
const ADMIN = 'dd-edit-admin@webatlas.test';
const VN_MANAGER = 'dd-edit-vn@webatlas.test'; // dictionary.manage on VN
const PROVINCE_MANAGER = 'dd-edit-province@webatlas.test'; // dictionary.manage on 48
const NOBODY = 'dd-edit-none@webatlas.test'; // no grant
const EMAILS = [ADMIN, VN_MANAGER, PROVINCE_MANAGER, NOBODY];
const GROUPS = ['dd-edit-vn', 'dd-edit-province'];
const ids = new Map<string, string>();

const LAYER = 'lakes';
const ATTR = 'volume_mcm';
const codeLayer = DICTIONARY[LAYER]!;
const codeAttr = codeLayer.attributes.find((a) => a.name === ATTR)!;
const LAYER_URL = `/api/dictionary/${LAYER}`;
const ATTR_URL = `${LAYER_URL}/${ATTR}`;
const HISTORY_URL = `/api/dictionary/history?layer=${LAYER}&attribute=${ATTR}`;
const FT_FIELDS = ['name', 'definition', 'geometryMeaning', 'validTo'];
const ATTR_FIELDS = ['label', 'definition', 'displayUnits', 'displayUnit', 'precision', 'cfStandardName', 'validTo'];

// One login per user: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function auth(email: string) {
  let token = tokens.get(email);
  if (!token) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
    token = res.json().token as string;
    tokens.set(email, token);
  }
  return { authorization: `Bearer ${token}` };
}

async function createGroup(name: string, unit: string, member: string) {
  const pg = getPool();
  const { rows } = await pg.query(`INSERT INTO app.access_groups (name) VALUES ($1) RETURNING id`, [name]);
  const groupId = rows[0].id as string;
  await pg.query(`INSERT INTO app.access_group_units (group_id, unit_code) VALUES ($1, $2)`, [groupId, unit]);
  await pg.query(`INSERT INTO app.access_group_permissions (group_id, permission) VALUES ($1, 'dictionary.manage')`, [groupId]);
  await pg.query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [ids.get(member), groupId]);
}

async function cleanup() {
  const pg = getPool();
  // The suite's own history rows, then its groups and users, each by exact name.
  await pg.query(
    `DELETE FROM app.dictionary_history WHERE changed_by IN (SELECT id FROM app.users WHERE email = ANY($1))`, [EMAILS]);
  await pg.query(`DELETE FROM app.access_groups WHERE name = ANY($1)`, [GROUPS]);
  await pg.query(`DELETE FROM app.users WHERE email = ANY($1)`, [EMAILS]);
}

/** Drops this suite's edits and lets the sync bring the fields back to the code defaults. */
async function resetDictionary() {
  const pg = getPool();
  await pg.query(`UPDATE app.dictionary_feature_types SET origin = origin - $2::text[] WHERE key = $1`, [LAYER, FT_FIELDS]);
  await pg.query(
    `UPDATE app.dictionary_attributes SET origin = origin - $3::text[] WHERE feature_type = $1 AND name = $2`,
    [LAYER, ATTR, ATTR_FIELDS]);
  await runSync(pg, { dryRun: false });
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  await resetDictionary();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [VN_MANAGER, 'viewer'], [PROVINCE_MANAGER, 'viewer'], [NOBODY, 'viewer']] as const) {
    const row = await repo.insert({ email, password_hash: await hashPassword(PW), full_name: email, role });
    ids.set(email, row.id);
  }
  await createGroup('dd-edit-vn', 'VN', VN_MANAGER);
  await createGroup('dd-edit-province', '48', PROVINCE_MANAGER);
});

afterEach(async () => { await resetDictionary(); });

afterAll(async () => {
  await resetDictionary();
  await cleanup();
  await app.close();
});

interface ServedAttribute { name: string; label: string; definition: string; displayUnits?: string[]; displayUnit?: string; revision: number }
interface ServedLayer { key: string; name: string; definition: string; revision: number; attributes: ServedAttribute[] }
interface HistoryRow {
  featureType: string; attribute: string | null; field: string; oldValue: unknown; newValue: unknown;
  reason: string; changedBy: { id: string; name: string } | null; changedAt: string;
}

async function layer(): Promise<ServedLayer> {
  const res = await app.inject({ method: 'GET', url: LAYER_URL });
  expect(res.statusCode).toBe(200);
  return res.json() as ServedLayer;
}
async function attr(): Promise<ServedAttribute> {
  return (await layer()).attributes.find((a) => a.name === ATTR)!;
}
async function patch(url: string, who: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PATCH', url, headers: await auth(who), payload });
}
async function restore(url: string, who: string, fields: string[]) {
  return app.inject({ method: 'POST', url: `${url}/restore`, headers: await auth(who), payload: { fields } });
}
async function history(who: string, query = HISTORY_URL) {
  return app.inject({ method: 'GET', url: query, headers: await auth(who) });
}
async function storedAttribute() {
  const { rows } = await getPool().query(
    `SELECT label, display_units, display_unit, origin, revision FROM app.dictionary_attributes WHERE feature_type = $1 AND name = $2`,
    [LAYER, ATTR]);
  return rows[0] as { label: string; display_units: string[]; display_unit: string; origin: Record<string, { by: string }>; revision: number };
}

describe('the dictionary edit API', () => {
  it('an admin edits a label and history records it', async () => {
    const before = await attr();
    expect(typeof before.revision).toBe('number');
    const res = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, label: 'Dung tích (dd-edit)' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedAttribute;
    expect(body.name).toBe(ATTR);
    expect(body.label).toBe('Dung tích (dd-edit)');
    expect(body.revision).toBe(before.revision + 1);
    expect(res.body).not.toContain('"origin"');

    const stored = await storedAttribute();
    expect(stored.origin.label!.by).toBe(ids.get(ADMIN));

    const rows = (await history(ADMIN)).json().history as HistoryRow[];
    expect(rows[0]).toMatchObject({
      featureType: LAYER, attribute: ATTR, field: 'label', oldValue: codeAttr.label, newValue: 'Dung tích (dd-edit)',
      reason: 'edit', changedBy: { id: ids.get(ADMIN), name: ADMIN },
    });
  });

  it('an edit that changes nothing writes nothing', async () => {
    const before = await attr();
    const res = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, label: before.label });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ServedAttribute).revision).toBe(before.revision);
    const stored = await storedAttribute();
    expect(stored.revision).toBe(before.revision);
    expect(Object.hasOwn(stored.origin, 'label')).toBe(false);
    const rows = (await history(ADMIN)).json().history as HistoryRow[];
    expect(rows.filter((r) => r.changedBy?.id === ids.get(ADMIN) && r.newValue === before.label)).toEqual([]);
  });

  it('dictionary.manage on VN allows edits', async () => {
    const before = await layer();
    const res = await patch(LAYER_URL, VN_MANAGER, { expectedRevision: before.revision, definition: 'Định nghĩa (dd-edit).' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedLayer;
    expect(body.definition).toBe('Định nghĩa (dd-edit).');
    expect(body.revision).toBe(before.revision + 1);
    expect(body.attributes.length).toBe(codeLayer.attributes.length);

    const back = await restore(LAYER_URL, VN_MANAGER, ['definition']);
    expect(back.statusCode).toBe(200);
    expect((back.json() as ServedLayer).definition).toBe(codeLayer.definition);

    const rows = (await history(VN_MANAGER, `/api/dictionary/history?layer=${LAYER}&limit=2`)).json().history as HistoryRow[];
    expect(rows.map((r) => [r.field, r.reason])).toEqual([['definition', 'restore'], ['definition', 'edit']]);
  });

  it('dictionary.manage on a province does not allow edits', async () => {
    const before = await attr();
    const res = await patch(ATTR_URL, PROVINCE_MANAGER, { expectedRevision: before.revision, label: 'x' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('OUT_OF_JURISDICTION');
    expect((await patch(LAYER_URL, PROVINCE_MANAGER, { expectedRevision: 0, name: 'x' })).statusCode).toBe(403);
    expect((await restore(ATTR_URL, PROVINCE_MANAGER, ['label'])).statusCode).toBe(403);
    expect((await history(PROVINCE_MANAGER)).statusCode).toBe(403);

    // No grant at all: the repo's NO_PERMISSION refusal. No sign-in: 401.
    const none = await patch(ATTR_URL, NOBODY, { expectedRevision: before.revision, label: 'x' });
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({
      error: { code: 'NO_PERMISSION', message: 'Anh/chị chưa có quyền quản lý từ điển dữ liệu ở đơn vị nào.' },
    });
    const anonymous = await app.inject({ method: 'PATCH', url: ATTR_URL, payload: { expectedRevision: 0, label: 'x' } });
    expect(anonymous.statusCode).toBe(401);

    const stored = await storedAttribute();
    expect(stored.label).toBe(codeAttr.label);
    expect(stored.revision).toBe(before.revision);
  });

  it('a stale revision is refused with the Vietnamese message', async () => {
    const before = await attr();
    const first = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, label: 'Người thứ nhất (dd-edit)' });
    expect(first.statusCode).toBe(200);
    const second = await patch(ATTR_URL, VN_MANAGER, { expectedRevision: before.revision, label: 'Người thứ hai (dd-edit)' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: { code: 'DICTIONARY_CHANGED', message: 'Mục này vừa được người khác sửa.' } });
    expect((await storedAttribute()).label).toBe('Người thứ nhất (dd-edit)');
  });

  it('a display unit outside the permitted list is refused', async () => {
    const before = await attr();
    const cases: [Record<string, unknown>, string][] = [
      [{ displayUnit: 'm3/s' }, 'displayUnit'], // another dimension
      [{ displayUnits: ['10*6.m3', 'MW'] }, 'displayUnits'], // another dimension in the list
      [{ displayUnits: ['10*6.m3', 'không-có'] }, 'displayUnits'], // not a unit
      [{ displayUnits: ['10*6.m3', 'm3'], displayUnit: 'km3' }, 'displayUnit'], // right dimension, not in the list
      [{ displayUnits: ['m3', 'km3'] }, 'displayUnits'], // drops the unit shown
    ];
    for (const [fields, field] of cases) {
      const res = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, ...fields });
      expect(res.statusCode, JSON.stringify(fields)).toBe(400);
      expect(res.json().error.details).toEqual({ field });
      expect(res.json().error.message).toMatch(/^Trường "/);
    }
    const stored = await storedAttribute();
    expect(stored.revision).toBe(before.revision);
    expect(stored.display_units).toEqual(codeAttr.displayUnits);
    expect(stored.display_unit).toBe(codeAttr.displayUnit);
  });

  it('a locked field is refused', async () => {
    const before = await attr();
    // The stored unit is corrected only with a valid-from date (storedUnit.test.ts); nodata never.
    const nodata = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, nodata: 0 });
    expect(nodata.statusCode).toBe(400);
    expect(nodata.json().error).toEqual({
      code: 'VALIDATION_ERROR', message: 'Trường "Giá trị không có dữ liệu" theo cấu trúc dữ liệu, không sửa được.',
      details: { field: 'nodata' },
    });
    const valueType = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, valueType: 'text' });
    expect(valueType.statusCode).toBe(400);
    expect(valueType.json().error.message).toBe('Chỉ đổi được kiểu của thuộc tính bổ sung.');

    const ft = await layer();
    const crs = await patch(LAYER_URL, ADMIN, { expectedRevision: ft.revision, crs: 3857 });
    expect(crs.statusCode).toBe(400);
    expect(crs.json().error.message).toBe('Trường "Hệ toạ độ" theo cấu trúc dữ liệu, không sửa được.');
    expect((await restore(ATTR_URL, ADMIN, ['source'])).json().error.message)
      .toBe('Trường "Nguồn" theo cấu trúc dữ liệu, không sửa được.');
    expect((await storedAttribute()).revision).toBe(before.revision);
  });

  it('the other rules are refused naming the field', async () => {
    const { revision } = await attr();
    const ft = await layer();
    const cases: [string, Record<string, unknown>, string][] = [
      [ATTR_URL, { precision: 7 }, 'precision'],
      [ATTR_URL, { precision: 1.5 }, 'precision'],
      [ATTR_URL, { cfStandardName: 'Lake Volume' }, 'cfStandardName'],
      [ATTR_URL, { label: '   ' }, 'label'],
      [ATTR_URL, { validTo: '2000-01-01' }, 'validTo'], // before validFrom
      [ATTR_URL, { validTo: '2026-02-30' }, 'validTo'], // not a date
      [LAYER_URL, { geometryMeaning: 'roughly' }, 'geometryMeaning'],
    ];
    for (const [url, fields, field] of cases) {
      const res = await patch(url, ADMIN, { expectedRevision: url === LAYER_URL ? ft.revision : revision, ...fields });
      expect(res.statusCode, JSON.stringify(fields)).toBe(400);
      expect(res.json().error.details).toEqual({ field });
    }
    // Valid values pass: a CF name, a retire date, and null to clear them again.
    const ok = await patch(ATTR_URL, ADMIN, { expectedRevision: revision, cfStandardName: 'lake_water_volume', validTo: '2030-01-01', precision: 0 });
    expect(ok.statusCode).toBe(200);
    const cleared = await patch(ATTR_URL, ADMIN, { expectedRevision: revision + 1, cfStandardName: null, validTo: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).not.toHaveProperty('cfStandardName');
    expect(cleared.json()).not.toHaveProperty('validTo');
  });

  it('restore takes the current code default', async () => {
    // The stored default predates a code change (as if the sync had not run since).
    await getPool().query(
      `UPDATE app.dictionary_attributes SET label = 'Nhãn cũ (dd-edit)' WHERE feature_type = $1 AND name = $2`, [LAYER, ATTR]);
    const before = await attr();
    expect(before.label).toBe('Nhãn cũ (dd-edit)');
    expect((await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, label: 'Nhãn sửa (dd-edit)' })).statusCode).toBe(200);

    const res = await restore(ATTR_URL, ADMIN, ['label']);
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedAttribute;
    expect(body.label).toBe(codeAttr.label);
    expect(body.revision).toBe(before.revision + 2);
    expect(Object.hasOwn((await storedAttribute()).origin, 'label')).toBe(false);

    const rows = (await history(ADMIN)).json().history as HistoryRow[];
    expect(rows[0]).toMatchObject({ field: 'label', oldValue: 'Nhãn sửa (dd-edit)', newValue: codeAttr.label, reason: 'restore' });
    expect(rows[1]).toMatchObject({ field: 'label', oldValue: 'Nhãn cũ (dd-edit)', reason: 'edit' });
  });

  it('restoring the display unit also restores a permitted list that excludes its default', async () => {
    const before = await attr();
    const edit = await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, displayUnits: ['m3', 'km3'], displayUnit: 'm3' });
    expect(edit.statusCode).toBe(200);
    const res = await restore(ATTR_URL, ADMIN, ['displayUnit']);
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedAttribute;
    expect(body.displayUnit).toBe(codeAttr.displayUnit);
    expect(body.displayUnits).toEqual(codeAttr.displayUnits);
    const stored = await storedAttribute();
    expect(Object.hasOwn(stored.origin, 'displayUnits')).toBe(false);
    expect(Object.hasOwn(stored.origin, 'displayUnit')).toBe(false);
  });

  it('history lists edits newest first', async () => {
    const before = await attr();
    expect((await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, label: 'Thứ nhất (dd-edit)' })).statusCode).toBe(200);
    expect((await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision + 1, definition: 'Thứ hai (dd-edit).' })).statusCode).toBe(200);
    const res = await history(ADMIN, `${HISTORY_URL}&limit=2`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().history as HistoryRow[];
    expect(rows.map((r) => r.field)).toEqual(['definition', 'label']);
    expect(rows[0]!.changedAt >= rows[1]!.changedAt).toBe(true);

    expect((await history(ADMIN, `${HISTORY_URL}&limit=201`)).statusCode).toBe(400);
  });

  it('the sync keeps an edited label', async () => {
    const before = await attr();
    expect((await patch(ATTR_URL, ADMIN, { expectedRevision: before.revision, label: 'Giữ qua đồng bộ (dd-edit)' })).statusCode).toBe(200);
    const counts = await runSync(getPool(), { dryRun: false });
    expect(counts.reverted).toBe(0);
    expect((await attr()).label).toBe('Giữ qua đồng bộ (dd-edit)');
  });
});

describe('GET /api/dictionary', () => {
  it('serves revisions on one layer only, not on the full list', async () => {
    const one = await layer();
    expect(typeof one.revision).toBe('number');
    expect(one.attributes.every((a) => typeof a.revision === 'number')).toBe(true);
    const all = await app.inject({ method: 'GET', url: '/api/dictionary' });
    expect(all.body).not.toContain('"revision"');
  });
});
