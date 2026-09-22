import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../server';
import { closePool, getPool } from '../../db/pool';
import { buildReferenceLayer } from '../../db/referenceEntities';

// Matches the house pattern in modules/admin-units/adminUnits.test.ts.
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  // Cheapest layer to build; guarantees the table is populated even if this file
  // runs before the builder's own suite.
  await buildReferenceLayer(getPool(), 'railways');
}, 120_000);

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/reference/layers', () => {
  it('lists the five in-scope layers with their metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/layers' });
    expect(res.statusCode).toBe(200);
    const { layers } = res.json();
    expect(layers.map((l: { key: string }) => l.key).sort()).toEqual(
      ['landuse', 'places', 'railways', 'roads', 'water']
    );
    const places = layers.find((l: { key: string }) => l.key === 'places');
    expect(places.summable).toEqual(['population']);
    expect(places.geomKind).toBe('point');
  });
});

describe('GET /api/reference/:layer/entities', () => {
  it('returns entities without geometry, newest-irrelevant order by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=5' });
    expect(res.statusCode).toBe(200);
    const { entities } = res.json();
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.length).toBeLessThanOrEqual(5);
    expect(entities[0]).toHaveProperty('entityId');
    expect(entities[0]).toHaveProperty('memberCount');
    expect(entities[0]).toHaveProperty('bbox');
    // The list endpoint stays light: no geometry.
    expect(entities[0]).not.toHaveProperty('geometry');
  });

  it('filters by trigram query', async () => {
    // limit=200 is the endpoint's max and comfortably covers the whole layer
    // (203 rows), so this is the full unfiltered set to narrow against.
    const all = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=200' });
    const unfiltered = all.json().entities as { name: string | null; ref: string | null }[];
    const first = unfiltered.find((e) => e.name)?.name as string;
    const term = first.slice(0, 6);

    // Same limit on the filtered request: if the q filter were ever dropped
    // from the SQL, this call would return the same 200 rows as `unfiltered`
    // and the narrowing assertion below would catch it.
    const res = await app.inject({
      method: 'GET',
      url: `/api/reference/railways/entities?limit=200&q=${encodeURIComponent(term)}`,
    });
    expect(res.statusCode).toBe(200);
    const filtered = res.json().entities as { name: string | null; ref: string | null }[];

    // Narrowing: the filter actually excludes non-matching rows, not just re-sorts them.
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(unfiltered.length);

    // Relevance: every hit genuinely relates to the term (not just a trigram
    // fluke) — name or ref contains the search substring, diacritics and all.
    const needle = term.toLowerCase();
    for (const e of filtered) {
      const haystack = `${e.name ?? ''} ${e.ref ?? ''}`.toLowerCase();
      expect(haystack).toContain(needle);
    }
  });

  it('rejects an unknown layer with 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/dams/entities' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a national duplicate as an unknown layer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/roads_vn/entities' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a limit outside the allowed range', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=5000' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/reference/:layer/entities/:entityId', () => {
  it('returns one entity with its geometry', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=1' });
    const { entityId } = list.json().entities[0];

    const res = await app.inject({
      method: 'GET',
      url: `/api/reference/railways/entities/${encodeURIComponent(entityId)}`,
    });
    expect(res.statusCode).toBe(200);
    const { entity } = res.json();
    expect(entity.entityId).toBe(entityId);
    expect(entity.geometry).toBeTruthy();
    expect(entity.geometry.type).toMatch(/LineString/);
  });

  it('404s on an unknown entity id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reference/railways/entities/railways:00000000000000000000000000000000:0',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the id belongs to another layer', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=1' });
    const { entityId } = list.json().entities[0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/reference/water/entities/${encodeURIComponent(entityId)}`,
    });
    expect(res.statusCode).toBe(404);
  });
});
