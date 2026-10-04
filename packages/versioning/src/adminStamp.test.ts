import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from './testPool';
import { stampAdminCodes } from './adminStamp';

let versionId: string;

// A throwaway ingest version of `dams` with three known points, so the assertions do not
// depend on whatever the seed happens to contain.
const FIXTURES = [
  { external_id: 900001, name: 'stamp-bmt', lon: 108.05, lat: 12.68 },   // Buôn Ma Thuột, Đắk Lắk (66)
  { external_id: 900002, name: 'stamp-sea', lon: 112.5, lat: 10.5 },     // open sea, no unit
];

beforeAll(async () => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ('dams', 'ingest', 'adminStamp.test', 'stamp-test', false) RETURNING id`
    );
    versionId = rows[0].id;
    for (const f of FIXTURES) {
      await client.query(
        `INSERT INTO water.dams (external_id, name, geom, dataset_version_id)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)`,
        [f.external_id, f.name, f.lon, f.lat, versionId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await getPool().query('DELETE FROM water.dams WHERE dataset_version_id = $1', [versionId]);
  await getPool().query('DELETE FROM app.dataset_versions WHERE id = $1', [versionId]);
  await closePool();
});

async function codes(name: string) {
  const { rows } = await getPool().query<{ province_codes: string[]; ward_codes: string[] }>(
    `SELECT province_codes, ward_codes FROM water.dams WHERE name = $1 AND dataset_version_id = $2`,
    [name, versionId]
  );
  return rows[0];
}

describe('stampAdminCodes', () => {
  it('stamps the province and ward containing a point, and reports the rows touched', async () => {
    const client = await getPool().connect();
    let touched = 0;
    try {
      await client.query('BEGIN');
      touched = await stampAdminCodes(client, 'dams', versionId);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(touched).toBe(FIXTURES.length);

    const bmt = await codes('stamp-bmt');
    expect(bmt.province_codes).toEqual(['66']);
    expect(bmt.ward_codes).toHaveLength(1);
  });

  it('gives an empty array — never null — to a feature outside every unit', async () => {
    const sea = await codes('stamp-sea');
    expect(sea.province_codes).toEqual([]);
    expect(sea.ward_codes).toEqual([]);
  });

  it('is idempotent: stamping twice yields the same codes', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await stampAdminCodes(client, 'dams', versionId);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await codes('stamp-bmt')).province_codes).toEqual(['66']);
  });

  it('refuses a layer key outside the allowlist rather than interpolating it', async () => {
    const client = await getPool().connect();
    try {
      await expect(
        stampAdminCodes(client, 'users; DROP TABLE app.users' as never, versionId)
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });
});
