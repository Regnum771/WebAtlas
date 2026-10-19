import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { versionsService } from './service';
import { refreshCurrentRows } from './currentRows';
import { stampManagingUnits } from './managingUnit';

const LAYER = 'dams';
const SOURCE = 'managingUnit.test';
// Inside ward 20194 (a point on its surface).
const WARD_POINT = { lon: 107.98933869063237, lat: 16.124395 };
const EXT_NEW = 900301;
const EXT_KEEP = 900302;

const created: string[] = [];
let priorActive: string | null = null;

afterAll(async () => {
  const pool = getPool();
  // Deactivate the test versions before restoring the prior one (one active per layer).
  for (const id of created) {
    await pool.query(`UPDATE app.dataset_versions SET is_active = false WHERE id = $1`, [id]);
  }
  if (priorActive) {
    await pool.query(`UPDATE app.dataset_versions SET is_active = true WHERE id = $1`, [priorActive]);
    const client = await pool.connect();
    try {
      await refreshCurrentRows(client, LAYER, priorActive);
    } finally {
      client.release();
    }
  }
  for (const id of created) {
    await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = $1`, [id]);
    await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
  }
  await closePool();
});

async function newVersion(client: pg.PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
     VALUES ($1, 'ingest', $2, 'managing-unit-test', false) RETURNING id`,
    [LAYER, SOURCE]
  );
  created.push(rows[0].id);
  return rows[0].id;
}

async function insertDam(
  client: pg.PoolClient, versionId: string, externalId: number, managingUnit: string | null
): Promise<void> {
  await client.query(
    `INSERT INTO water.dams (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit)
     VALUES ($1, 'mu-test', ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, '{}', '{}', $5)`,
    [externalId, WARD_POINT.lon, WARD_POINT.lat, versionId, managingUnit]
  );
}

async function unitOf(versionId: string, externalId: number): Promise<string | null> {
  const { rows } = await getPool().query<{ managing_unit: string | null }>(
    `SELECT managing_unit FROM water.dams WHERE dataset_version_id = $1 AND external_id = $2`,
    [versionId, externalId]
  );
  return rows[0].managing_unit;
}

describe('stampManagingUnits through versionsService.activate', () => {
  let v1: string;
  let v2: string;

  it('assigns the rule to a new external_id', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    priorActive = await svc.getActiveVersionId(LAYER);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      v1 = await newVersion(client);
      await insertDam(client, v1, EXT_NEW, null);
      await svc.activate(client, LAYER, v1);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    expect(await unitOf(v1, EXT_NEW)).toBe('20194');
  });

  it('inherits the managing unit of the current row with the same external_id', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    await pool.query(
      `UPDATE water.dams SET managing_unit = '48' WHERE dataset_version_id = $1 AND external_id = $2`,
      [v1, EXT_NEW]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      v2 = await newVersion(client);
      await insertDam(client, v2, EXT_NEW, null);
      await svc.activate(client, LAYER, v2);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    expect(await unitOf(v2, EXT_NEW)).toBe('48');
  });

  it('returns counts', async () => {
    // v2 is now active and current; a further version holding the same external_id inherits from it.
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const v3 = await newVersion(client);
      await insertDam(client, v3, EXT_NEW, null);
      expect(await stampManagingUnits(client, LAYER, v3)).toEqual({ inherited: 1, assigned: 0 });
      await client.query('ROLLBACK');
      created.pop();
    } finally {
      client.release();
    }
  });

  it('counts a brand-new external_id as assigned', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const v3 = await newVersion(client);
      await insertDam(client, v3, EXT_KEEP + 100, null);
      expect(await stampManagingUnits(client, LAYER, v3)).toEqual({ inherited: 0, assigned: 1 });
      await client.query('ROLLBACK');
      created.pop();
    } finally {
      client.release();
    }
  });

  it('never overwrites a set value', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const v3 = await newVersion(client);
      await insertDam(client, v3, EXT_KEEP, '51');
      // Same external_id as the current row (unit 48): the explicit value must still win.
      await insertDam(client, v3, EXT_NEW, '51');
      expect(await stampManagingUnits(client, LAYER, v3)).toEqual({ inherited: 0, assigned: 0 });
      const { rows } = await client.query<{ managing_unit: string }>(
        `SELECT managing_unit FROM water.dams WHERE dataset_version_id = $1`, [v3]
      );
      expect(rows.map((r) => r.managing_unit)).toEqual(['51', '51']);
      await client.query('ROLLBACK');
      created.pop();
    } finally {
      client.release();
    }
  });

  it('refuses a layer key outside the allowlist', async () => {
    const client = await getPool().connect();
    try {
      await expect(stampManagingUnits(client, 'x; DROP TABLE y' as never, v1)).rejects.toThrow();
    } finally {
      client.release();
    }
  });
});
