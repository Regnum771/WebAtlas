import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { resolveFeature } from '../assistant/tools/data/helpers';

let app: ReturnType<typeof buildApp>;
let riverId: string;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id::text FROM water.rivers_active WHERE name IS NOT NULL ORDER BY length_m DESC NULLS LAST LIMIT 1`
  );
  riverId = rows[0].id;
});
afterAll(async () => {
  await app.close();
});

describe('resolveFeature', () => {
  it('returns the active row with geometry, a representative point and text properties', async () => {
    const f = await resolveFeature(getPool(), 'rivers', riverId);
    expect(f).not.toBeNull();
    expect(f!.featureId).toBe(riverId);
    expect(['LineString', 'MultiLineString']).toContain(f!.geometry.type);
    expect(f!.lon).toBeGreaterThan(100);
    expect(Object.keys(f!.properties)).toContain('stream_order');
  });

  it('simplifies by default and keeps full precision on request', async () => {
    const simple = await resolveFeature(getPool(), 'rivers', riverId);
    const full = await resolveFeature(getPool(), 'rivers', riverId, { simplify: false });
    const n = (g: { coordinates: unknown }) => JSON.stringify(g.coordinates).split('],[').length;
    expect(n(simple!.geometry)).toBeLessThanOrEqual(n(full!.geometry));
  });

  it('returns null for a malformed or unknown id instead of throwing', async () => {
    expect(await resolveFeature(getPool(), 'rivers', 'not-a-uuid')).toBeNull();
    expect(await resolveFeature(getPool(), 'rivers', '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('GET /api/features/:layerKey/:id/geometry', () => {
  it('returns simplified geometry without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/features/rivers/${riverId}/geometry` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.featureId).toBe(riverId);
    expect(body.layerKey).toBe('rivers');
    expect(['LineString', 'MultiLineString']).toContain(body.geometry.type);
  });

  it('404s an unknown feature and 400s an unknown layer', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/features/rivers/00000000-0000-0000-0000-000000000000/geometry' });
    expect(missing.statusCode).toBe(404);
    const badLayer = await app.inject({ method: 'GET', url: `/api/features/users/${riverId}/geometry` });
    expect(badLayer.statusCode).toBe(400);
  });
});
