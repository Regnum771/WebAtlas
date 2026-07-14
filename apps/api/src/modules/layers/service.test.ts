import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { featuresService } from './service';
import { GeometryError, NotFoundError } from '../../errors';

const TEST_NAME = 'svc-test-dam@webatlas.test';

describe('featuresService (dams)', () => {
  const svc = () => featuresService(getPool());
  const created: string[] = [];

  afterAll(async () => {
    await getPool().query('DELETE FROM water.dams WHERE name = $1', [TEST_NAME]);
    await closePool();
  });

  it('rejects an unknown layer key with NotFoundError', async () => {
    await expect(svc().list('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates a dam feature, lists it, then removes it (audit written)', async () => {
    const feature = {
      geometry: { type: 'Point', coordinates: [105.8, 21.0] },
      properties: { name: TEST_NAME, status: 'operational' },
    };
    const row = await svc().create('dams', feature, undefined);
    created.push(row.id);
    expect(row.geometry).toMatchObject({ type: 'Point' });
    expect(row.properties.name).toBe(TEST_NAME);

    const listed = await svc().list('dams');
    expect(listed.some((r) => r.id === row.id)).toBe(true);

    await svc().remove('dams', row.id, undefined);
    const after = await svc().get('dams', row.id);
    expect(after).toBeNull();

    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1 ORDER BY created_at`,
      [row.id]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'delete']);
  });

  it('rejects a wrong-type geometry with GeometryError', async () => {
    const feature = { geometry: { type: 'LineString', coordinates: [[105, 21], [106, 22]] }, properties: { name: TEST_NAME } };
    await expect(svc().create('dams', feature, undefined)).rejects.toBeInstanceOf(GeometryError);
  });
});
