import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DICTIONARY, type Dictionary } from '@webatlas/shared';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { runSync } from './sync';

/*
 * Listed values (Plan C Task 6): adding a code to an open list (stations.station_type) and the
 * refusals of a closed list (dams.status). The suite deletes the one code it adds (by its exact
 * code), its own history rows and its users; the closed-list refusals write nothing.
 */

const app = buildApp();
const PW = 'dd-values-pass-123';
const ADMIN = 'dd-values-admin@webatlas.test';
const NOBODY = 'dd-values-none@webatlas.test'; // no grant
const EMAILS = [ADMIN, NOBODY];
const ids = new Map<string, string>();

const OPEN = { layer: 'stations', attribute: 'station_type' };
const CLOSED = { layer: 'dams', attribute: 'status' };
const NEW_CODE = 'dd-values-trạm thử';
/** Added without a definition. */
const BARE_CODE = 'dd-values-không định nghĩa';
/** A code of the closed list's code default: its name, definition and colour hint are edited, then restored. */
const DEFAULT_CODE = DICTIONARY[CLOSED.layer]!.attributes.find((a) => a.name === CLOSED.attribute)!.values![0]!;
const OPEN_URL = `/api/dictionary/${OPEN.layer}/${OPEN.attribute}`;
const CLOSED_URL = `/api/dictionary/${CLOSED.layer}/${CLOSED.attribute}`;
const valueUrl = (base: string, code: string) => `${base}/values/${encodeURIComponent(code)}`;

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

async function cleanup() {
  const pg = getPool();
  await pg.query(`DELETE FROM app.dictionary_values WHERE feature_type = $1 AND attribute = $2 AND code = ANY($3)`,
    [OPEN.layer, OPEN.attribute, [NEW_CODE, BARE_CODE]]);
  // The edits of the default code lose their origin; the sync in afterAll brings its wording back.
  await pg.query(
    `UPDATE app.dictionary_values SET origin = origin - $4::text[] WHERE feature_type = $1 AND attribute = $2 AND code = $3`,
    [CLOSED.layer, CLOSED.attribute, DEFAULT_CODE.code, ['name', 'definition', 'colorHint']]);
  await pg.query(
    `DELETE FROM app.dictionary_history WHERE changed_by IN (SELECT id FROM app.users WHERE email = ANY($1))`, [EMAILS]);
  await pg.query(`DELETE FROM app.users WHERE email = ANY($1)`, [EMAILS]);
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  await runSync(getPool(), { dryRun: false });
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [NOBODY, 'viewer']] as const) {
    const row = await repo.insert({ email, password_hash: await hashPassword(PW), full_name: email, role });
    ids.set(email, row.id);
  }
});

afterAll(async () => {
  await cleanup();
  await runSync(getPool(), { dryRun: false });
  await app.close();
});

interface ServedValue { code: string; name: string; definition?: string; order: number; retired?: boolean; colorHint?: string }
interface ServedAttribute { name: string; revision: number; codeList?: string; values?: ServedValue[] }

async function attribute(layer: string, name: string): Promise<ServedAttribute> {
  const res = await app.inject({ method: 'GET', url: `/api/dictionary/${layer}` });
  expect(res.statusCode).toBe(200);
  return (res.json().attributes as ServedAttribute[]).find((a) => a.name === name)!;
}
async function storedValue(layer: string, attr: string, code: string) {
  const { rows } = await getPool().query(
    `SELECT code, name, definition, ord, retired, color_hint, origin FROM app.dictionary_values
      WHERE feature_type = $1 AND attribute = $2 AND code = $3`, [layer, attr, code]);
  return rows[0] as { name: string; definition: string | null; ord: number; retired: boolean; color_hint: string | null; origin: Record<string, { by: string }> } | undefined;
}

describe('listed values', () => {
  it('a code can be added to an open list and keeps its staff wording through a sync', async () => {
    const before = await attribute(OPEN.layer, OPEN.attribute);
    expect(before.codeList).toBe('open');
    const maxOrder = Math.max(...(before.values ?? []).map((v) => v.order));

    const res = await app.inject({
      method: 'POST', url: `${OPEN_URL}/values`, headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, code: `  ${NEW_CODE}  `, name: 'Trạm thử (dd-values)', definition: 'Định nghĩa thử.' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedAttribute;
    expect(body.revision).toBe(before.revision + 1);
    expect(body.values!.at(-1)).toEqual({ code: NEW_CODE, name: 'Trạm thử (dd-values)', definition: 'Định nghĩa thử.', order: maxOrder + 1 });

    const stored = (await storedValue(OPEN.layer, OPEN.attribute, NEW_CODE))!;
    expect(Object.keys(stored.origin).sort()).toEqual(['code', 'definition', 'name']);
    expect(stored.origin.code!.by).toBe(ids.get(ADMIN));

    // The same code again is refused, trimmed or not.
    const again = await app.inject({
      method: 'POST', url: `${OPEN_URL}/values`, headers: await auth(ADMIN),
      payload: { expectedRevision: body.revision, code: NEW_CODE, name: 'Lần hai' },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.details).toEqual({ field: 'code' });

    // A later code default for the same code never overwrites the staff wording.
    const entry = structuredClone(DICTIONARY[OPEN.layer]!);
    entry.attributes.find((a) => a.name === OPEN.attribute)!.values!.push(
      { code: NEW_CODE, name: 'Tên mặc định (dd-values)', definition: 'Định nghĩa mặc định.', order: 99 });
    const defaults: Dictionary = { ...DICTIONARY, [OPEN.layer]: entry };
    expect((await runSync(getPool(), { dryRun: false, defaults })).reverted).toBe(0);
    // And once the code drops it again, an open list keeps the staff code.
    expect(await runSync(getPool(), { dryRun: false })).toMatchObject({ reverted: 0, retired: 0 });
    const kept = (await storedValue(OPEN.layer, OPEN.attribute, NEW_CODE))!;
    expect(kept).toMatchObject({ name: 'Trạm thử (dd-values)', definition: 'Định nghĩa thử.', retired: false });

    // Its wording, colour and use can be edited, which bumps the attribute's revision.
    const current = await attribute(OPEN.layer, OPEN.attribute);
    const edit = await app.inject({
      method: 'PATCH', url: valueUrl(OPEN_URL, NEW_CODE), headers: await auth(ADMIN),
      payload: { expectedRevision: current.revision, name: 'Trạm thử đổi tên (dd-values)', colorHint: '#1A2b3C', retired: true },
    });
    expect(edit.statusCode).toBe(200);
    const edited = edit.json() as ServedAttribute;
    expect(edited.revision).toBe(current.revision + 1);
    expect(edited.values!.find((v) => v.code === NEW_CODE)).toMatchObject(
      { name: 'Trạm thử đổi tên (dd-values)', colorHint: '#1A2b3C', retired: true });
    const bad = await app.inject({
      method: 'PATCH', url: valueUrl(OPEN_URL, NEW_CODE), headers: await auth(ADMIN),
      payload: { expectedRevision: edited.revision, colorHint: 'red' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details).toEqual({ field: 'colorHint' });
    const stale = await app.inject({
      method: 'PATCH', url: valueUrl(OPEN_URL, NEW_CODE), headers: await auth(ADMIN),
      payload: { expectedRevision: current.revision, name: 'Cũ' },
    });
    expect(stale.statusCode).toBe(409);

    const history = await app.inject({
      method: 'GET', url: `/api/dictionary/history?layer=${OPEN.layer}&attribute=${OPEN.attribute}&limit=6`, headers: await auth(ADMIN),
    });
    const rows = history.json().history as { code: string; field: string; oldValue: unknown; newValue: unknown; reason: string }[];
    expect(rows.map((r) => [r.code, r.field, r.reason])).toEqual([
      [NEW_CODE, 'retired', 'edit'], [NEW_CODE, 'colorHint', 'edit'], [NEW_CODE, 'name', 'edit'],
      [NEW_CODE, 'definition', 'edit'], [NEW_CODE, 'name', 'edit'], [NEW_CODE, 'code', 'edit'],
    ]);
    expect(rows[5]).toMatchObject({ oldValue: null, newValue: NEW_CODE });
  });

  it('a code added without a definition gets no definition origin', async () => {
    const before = await attribute(OPEN.layer, OPEN.attribute);
    const res = await app.inject({
      method: 'POST', url: `${OPEN_URL}/values`, headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, code: BARE_CODE, name: 'Không định nghĩa (dd-values)' },
    });
    expect(res.statusCode).toBe(200);
    const stored = (await storedValue(OPEN.layer, OPEN.attribute, BARE_CODE))!;
    expect(stored.definition).toBeNull();
    expect(Object.keys(stored.origin).sort()).toEqual(['code', 'name']);
  });

  it('a listed value is restored to its current code default', async () => {
    const before = await attribute(CLOSED.layer, CLOSED.attribute);
    const edit = await app.inject({
      method: 'PATCH', url: valueUrl(CLOSED_URL, DEFAULT_CODE.code), headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, name: 'Tên sửa (dd-values)', definition: 'Định nghĩa sửa.', colorHint: '#010203' },
    });
    expect(edit.statusCode).toBe(200);
    const edited = edit.json() as ServedAttribute;

    const res = await app.inject({
      method: 'POST', url: `${valueUrl(CLOSED_URL, DEFAULT_CODE.code)}/restore`, headers: await auth(ADMIN),
      payload: { expectedRevision: edited.revision, fields: ['name', 'definition', 'colorHint'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ServedAttribute;
    expect(body.revision).toBe(edited.revision + 1);
    expect(body.values!.find((v) => v.code === DEFAULT_CODE.code)).toMatchObject(
      { name: DEFAULT_CODE.name, definition: DEFAULT_CODE.definition, colorHint: DEFAULT_CODE.colorHint });
    expect((await storedValue(CLOSED.layer, CLOSED.attribute, DEFAULT_CODE.code))!.origin).toEqual({});

    const history = await app.inject({
      method: 'GET', url: `/api/dictionary/history?layer=${CLOSED.layer}&attribute=${CLOSED.attribute}&limit=3`, headers: await auth(ADMIN),
    });
    const rows = history.json().history as { code: string; field: string; oldValue: unknown; newValue: unknown; reason: string }[];
    expect(rows.map((r) => [r.code, r.field, r.reason]).sort()).toEqual([
      [DEFAULT_CODE.code, 'colorHint', 'restore'], [DEFAULT_CODE.code, 'definition', 'restore'], [DEFAULT_CODE.code, 'name', 'restore'],
    ]);
    expect(rows.find((r) => r.field === 'name')).toMatchObject({ oldValue: 'Tên sửa (dd-values)', newValue: DEFAULT_CODE.name });

    // Nothing left to restore: no write, no revision bump.
    const again = await app.inject({
      method: 'POST', url: `${valueUrl(CLOSED_URL, DEFAULT_CODE.code)}/restore`, headers: await auth(ADMIN),
      payload: { expectedRevision: body.revision, fields: ['name'] },
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as ServedAttribute).revision).toBe(body.revision);
  });

  it('a stale value restore is refused and writes nothing', async () => {
    const before = await attribute(CLOSED.layer, CLOSED.attribute);
    const edit = await app.inject({
      method: 'PATCH', url: valueUrl(CLOSED_URL, DEFAULT_CODE.code), headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, name: 'Tên mới hơn (dd-values)' },
    });
    expect(edit.statusCode).toBe(200);
    const res = await app.inject({
      method: 'POST', url: `${valueUrl(CLOSED_URL, DEFAULT_CODE.code)}/restore`, headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, fields: ['name'] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DICTIONARY_CHANGED');
    const stored = (await storedValue(CLOSED.layer, CLOSED.attribute, DEFAULT_CODE.code))!;
    expect(stored.name).toBe('Tên mới hơn (dd-values)');
    expect(Object.hasOwn(stored.origin, 'name')).toBe(true);
    expect((await attribute(CLOSED.layer, CLOSED.attribute)).revision).toBe(before.revision + 1);

    // Put it back for the tests after this one.
    const back = await app.inject({
      method: 'POST', url: `${valueUrl(CLOSED_URL, DEFAULT_CODE.code)}/restore`, headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision + 1, fields: ['name'] },
    });
    expect(back.statusCode).toBe(200);
  });

  it('a staff-added code has no default to restore to', async () => {
    if (!(await storedValue(OPEN.layer, OPEN.attribute, BARE_CODE))) {
      const add = await app.inject({
        method: 'POST', url: `${OPEN_URL}/values`, headers: await auth(ADMIN),
        payload: { expectedRevision: (await attribute(OPEN.layer, OPEN.attribute)).revision, code: BARE_CODE, name: 'Không định nghĩa (dd-values)' },
      });
      expect(add.statusCode).toBe(200);
    }
    const current = await attribute(OPEN.layer, OPEN.attribute);
    const res = await app.inject({
      method: 'POST', url: `${valueUrl(OPEN_URL, BARE_CODE)}/restore`, headers: await auth(ADMIN),
      payload: { expectedRevision: current.revision, fields: ['name'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(`Giá trị "${BARE_CODE}" do cán bộ thêm, không có giá trị mặc định để khôi phục.`);
    expect((await storedValue(OPEN.layer, OPEN.attribute, BARE_CODE))!.name).toBe('Không định nghĩa (dd-values)');
    expect((await attribute(OPEN.layer, OPEN.attribute)).revision).toBe(current.revision);

    // A field a listed value does not edit is refused naming it.
    const odd = await app.inject({
      method: 'POST', url: `${valueUrl(CLOSED_URL, DEFAULT_CODE.code)}/restore`, headers: await auth(ADMIN),
      payload: { expectedRevision: (await attribute(CLOSED.layer, CLOSED.attribute)).revision, fields: ['ord'] },
    });
    expect(odd.statusCode).toBe(400);
    expect(odd.json().error.details).toEqual({ field: 'ord' });
  });

  it('adding to a closed list is refused', async () => {
    const before = await attribute(CLOSED.layer, CLOSED.attribute);
    expect(before.codeList).toBe('closed');
    const res = await app.inject({
      method: 'POST', url: `${CLOSED_URL}/values`, headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, code: 'dd-values-closed', name: 'Không thêm được' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Danh sách giá trị này theo cấu trúc dữ liệu, không thêm được.');
    expect(await storedValue(CLOSED.layer, CLOSED.attribute, 'dd-values-closed')).toBeUndefined();
    expect((await attribute(CLOSED.layer, CLOSED.attribute)).revision).toBe(before.revision);

    // An attribute without a code list has no values to add to.
    const watt = await attribute('dams', 'wattage_mw');
    const none = await app.inject({
      method: 'POST', url: '/api/dictionary/dams/wattage_mw/values', headers: await auth(ADMIN),
      payload: { expectedRevision: watt.revision, code: 'x', name: 'x' },
    });
    expect(none.statusCode).toBe(400);
  });

  it('retiring on a closed list is refused', async () => {
    const before = await attribute(CLOSED.layer, CLOSED.attribute);
    const code = before.values![0]!.code;
    const res = await app.inject({
      method: 'PATCH', url: valueUrl(CLOSED_URL, code), headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, retired: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ details: { field: 'retired' } });
    const stored = (await storedValue(CLOSED.layer, CLOSED.attribute, code))!;
    expect(stored.retired).toBe(false);
    expect(Object.hasOwn(stored.origin, 'retired')).toBe(false);
    expect((await attribute(CLOSED.layer, CLOSED.attribute)).revision).toBe(before.revision);

    // A code that is not listed is 404.
    const missing = await app.inject({
      method: 'PATCH', url: valueUrl(CLOSED_URL, 'không-có'), headers: await auth(ADMIN),
      payload: { expectedRevision: before.revision, name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('the value routes need dictionary.manage', async () => {
    const { revision } = await attribute(OPEN.layer, OPEN.attribute);
    const headers = await auth(NOBODY);
    const add = await app.inject({ method: 'POST', url: `${OPEN_URL}/values`, headers, payload: { expectedRevision: revision, code: 'x', name: 'x' } });
    expect(add.statusCode).toBe(403);
    const edit = await app.inject({ method: 'PATCH', url: valueUrl(OPEN_URL, 'Đo mực nước'), headers, payload: { expectedRevision: revision, name: 'x' } });
    expect(edit.statusCode).toBe(403);
    const preview = await app.inject({ method: 'POST', url: '/api/dictionary/dams/wattage_mw/stored-unit/preview', headers, payload: { storedUnit: 'kW' } });
    expect(preview.statusCode).toBe(403);
    const restore = await app.inject({
      method: 'POST', url: `${valueUrl(OPEN_URL, 'Đo mực nước')}/restore`, headers, payload: { expectedRevision: revision, fields: ['name'] },
    });
    expect(restore.statusCode).toBe(403);
    expect((await attribute(OPEN.layer, OPEN.attribute)).revision).toBe(revision);
  });
});
