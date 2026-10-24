import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { DICTIONARY, type DictFeatureType, type Dictionary } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';
import { runSync, syncInTransaction, type SyncCounts } from './sync';

// Every test leaves the dictionary tables as it found them: the applier runs inside transactions
// that are rolled back, and the dry run rolls back by itself.
afterAll(async () => { await closePool(); });

const TODAY = '2026-10-24';
const ZERO: SyncCounts = { added: 0, updated: 0, retired: 0, reverted: 0 };

/** A feature type no real layer uses, so a run always has something to add whatever the dev DB holds. */
const TEST_ENTRY: DictFeatureType = {
  key: 'dd-t6-sync',
  kind: 'vector',
  name: 'Lớp thử đồng bộ',
  definition: 'Chỉ dùng trong kiểm thử.',
  table: 'water.dd_t6_sync',
  crs: 4326,
  geometryType: 'Point',
  geometryMeaning: 'exact',
  validFrom: '2026-01-01',
  attributes: [{
    name: 'kind', source: 'column', valueType: 'code', label: 'Loại', definition: 'Loại thử.', codeList: 'open',
    values: [{ code: 'a', name: 'A', order: 1 }], validFrom: '2026-01-01',
  }],
};
const WITH_TEST_ENTRY: Dictionary = { ...DICTIONARY, [TEST_ENTRY.key]: TEST_ENTRY };

/** Every dictionary row as JSON, in key order; synced_at is a timestamp of the run and is left out. */
async function snapshot(q: pg.Pool | pg.PoolClient): Promise<unknown[]> {
  const { rows } = await q.query<{ r: unknown }>(`
    SELECT r FROM (
      SELECT 1 AS t, key AS k1, '' AS k2, '' AS k3, to_jsonb(f) - 'synced_at' AS r FROM app.dictionary_feature_types f
      UNION ALL SELECT 2, feature_type, name, '', to_jsonb(a) FROM app.dictionary_attributes a
      UNION ALL SELECT 3, feature_type, attribute, code, to_jsonb(v) FROM app.dictionary_values v
      UNION ALL SELECT 4, '', '', '', jsonb_build_object('history', count(*)) FROM app.dictionary_history
    ) s ORDER BY t, k1, k2, k3`);
  return rows.map((row) => row.r);
}

async function rolledBack<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Polls until the backend `pid` waits for an advisory lock; false after `ms`. */
async function waitsForAdvisoryLock(pid: number, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND pid = $1`, [pid]);
    if (rows.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe('runSync (spec §2.1)', () => {
  it('a second run changes nothing', async () => {
    await rolledBack(async (client) => {
      const first = await syncInTransaction(client, WITH_TEST_ENTRY, TODAY);
      expect(first.added).toBeGreaterThan(0);
      expect(await syncInTransaction(client, WITH_TEST_ENTRY, TODAY)).toEqual(ZERO);
    });
  });

  it('two concurrent syncs end in the same state as one', async () => {
    // One run on its own, from the current state.
    const one = await rolledBack(async (client) => {
      const counts = await syncInTransaction(client, WITH_TEST_ENTRY, TODAY);
      return { counts, rows: await snapshot(client) };
    });

    const a = await getPool().connect();
    const b = await getPool().connect();
    try {
      const pid = async (c: pg.PoolClient) => (await c.query<{ p: number }>('SELECT pg_backend_pid() AS p')).rows[0].p;
      const pids = new Map([[a, await pid(a)], [b, await pid(b)]]);
      let holder: pg.PoolClient | undefined;
      let otherWaited = false;
      // Whichever run takes the lock first holds it until the other is seen waiting for it, so the
      // two really overlap; both roll back.
      const run = async (me: pg.PoolClient, other: pg.PoolClient) => {
        await me.query('BEGIN');
        try {
          const counts = await syncInTransaction(me, WITH_TEST_ENTRY, TODAY);
          if (!holder) {
            holder = me;
            otherWaited = await waitsForAdvisoryLock(pids.get(other)!);
          }
          return { counts, rows: await snapshot(me) };
        } finally {
          await me.query('ROLLBACK');
        }
      };
      const [ra, rb] = await Promise.all([run(a, b), run(b, a)]);

      expect(otherWaited).toBe(true);
      expect(ra).toEqual(one);
      expect(rb).toEqual(one);
    } finally {
      a.release();
      b.release();
    }
  });

  it('dry run writes nothing', async () => {
    const before = await snapshot(getPool());
    const counts = await runSync(getPool(), { dryRun: true, today: TODAY, defaults: WITH_TEST_ENTRY });
    expect(counts.added).toBeGreaterThan(0);
    expect(await snapshot(getPool())).toEqual(before);
  });

  it('a revert and a retire each write a history row', async () => {
    await rolledBack(async (client) => {
      await syncInTransaction(client, DICTIONARY, TODAY);
      // A staff edit, written the way the editor will: the value plus its origin entry.
      const editor = '00000000-0000-4000-8000-0000000000e6';
      await client.query(
        `UPDATE app.dictionary_attributes
            SET display_unit = 'kW',
                origin = origin || jsonb_build_object('displayUnit', jsonb_build_object('by', $1::text, 'at', now()))
          WHERE feature_type = 'dams' AND name = 'wattage_mw'`, [editor]);
      const before = await client.query<{ revision: number }>(
        `SELECT revision FROM app.dictionary_attributes WHERE feature_type = 'dams' AND name = 'wattage_mw'`);

      // The next code version permits only MW and drops the last attribute (the last one, so no
      // other attribute changes position).
      const dropped = DICTIONARY.dams.attributes.at(-1)!.name;
      const dams = structuredClone(DICTIONARY.dams);
      dams.attributes = dams.attributes
        .filter((a) => a.name !== dropped)
        .map((a) => (a.name === 'wattage_mw' ? { ...a, displayUnits: ['MW'] } : a));
      const counts = await syncInTransaction(client, { ...DICTIONARY, dams }, TODAY);
      expect(counts).toEqual({ added: 0, updated: 1, retired: 1, reverted: 1 });

      const { rows: history } = await client.query(
        `SELECT attribute, code, field, old_value, new_value, reason, changed_by
           FROM app.dictionary_history WHERE feature_type = 'dams' AND changed_at = now() ORDER BY id`);
      expect(history).toEqual([
        { attribute: 'wattage_mw', code: null, field: 'displayUnit', old_value: 'kW', new_value: 'MW', reason: 'sync_revert', changed_by: null },
        { attribute: dropped, code: null, field: 'validTo', old_value: null, new_value: TODAY, reason: 'sync_retire', changed_by: null },
      ]);
      const { rows: [watt] } = await client.query(
        `SELECT display_unit, display_units, origin, revision FROM app.dictionary_attributes
          WHERE feature_type = 'dams' AND name = 'wattage_mw'`);
      expect(watt).toMatchObject({ display_unit: 'MW', display_units: ['MW'], origin: {} });
      expect(watt.revision).toBeGreaterThan(before.rows[0].revision);
      const { rows: [retired] } = await client.query(
        `SELECT valid_to::text AS valid_to FROM app.dictionary_attributes WHERE feature_type = 'dams' AND name = $1`, [dropped]);
      expect(retired.valid_to).toBe(TODAY);
    });
  });
});
