import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { buildReferenceLayer } from '../../db/referenceEntities';

let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /api/search', () => {
  it('rejects a missing query', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a query shorter than two characters', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=a' });
    expect(res.statusCode).toBe(400);
  });

  it('returns matching features with coordinates, including a known river', async () => {
    // 'Sông Thu Bồn' is seeded ingest data (water.rivers_active); this pins the
    // assertion to real content so the test fails if the query or join breaks,
    // not just if the endpoint is unreachable.
    const res = await app.inject({ method: 'GET', url: '/api/search?q=thu' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ layerKey: string; featureId: string; lonLat: [number, number]; name: string }> };
    expect(body.results.length).toBeGreaterThan(0);

    const river = body.results.find((h) => h.name === 'Sông Thu Bồn');
    expect(river).toBeDefined();
    expect(river!.layerKey).toBe('rivers');
    expect(typeof river!.featureId).toBe('string');
    // Sanity-check the point actually lands in Vietnam, not (0,0) or swapped axes.
    const [lon, lat] = river!.lonLat;
    expect(lon).toBeGreaterThan(100);
    expect(lon).toBeLessThan(112);
    expect(lat).toBeGreaterThan(8);
    expect(lat).toBeLessThan(24);

    for (const hit of body.results) {
      expect(hit.lonLat).toHaveLength(2);
      expect(typeof hit.name).toBe('string');
    }
  });

  it('caps results at the requested limit', async () => {
    // Unlimited, 'an' trigram-matches 6 distinct dam/lake names in the seeded data
    // (verified directly against water.*_active), so limit=3 only proves the cap
    // is enforced if it actually truncates a real surplus.
    const res = await app.inject({ method: 'GET', url: '/api/search?q=an&limit=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ name: string }> };
    expect(body.results.length).toBe(3);
    // Highest-similarity match ('An Điềm', sim 0.375) must win the ordering, not
    // just whichever 3 rows a broken/unordered query happened to return first.
    expect(body.results[0].name).toBe('An Điềm');
  });
});

describe('GET /api/search with sources', () => {
  it('returns only water-layer hits by default, unchanged from before', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song' });
    expect(res.statusCode).toBe(200);
    for (const hit of res.json().results) {
      expect(hit.source).toBe('layer');
    }
  });

  it('returns reference hits when a ref: source is asked for', async () => {
    await buildReferenceLayer(getPool(), 'railways');
    const list = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=50' });
    const named = list.json().entities.find((e: { name: string | null }) => e.name);
    const term = (named.name as string).slice(0, 6);

    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(term)}&sources=ref:railways`,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      expect(hit.source).toBe('reference');
      expect(hit.layerKey).toBe('railways');
      // A reference hit is navigable: featureId is the entity id.
      expect(hit.featureId).toMatch(/^railways:[0-9a-f]{32}:\d+$/);
      expect(hit.lonLat).toHaveLength(2);
    }
  });

  it('mixes sources when both kinds are asked for', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=dinh&sources=rivers,ref:water',
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as Array<{ source: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((hit) => hit.source === 'layer')).toBe(true);
    expect(results.some((hit) => hit.source === 'reference')).toBe(true);
    for (const hit of results) {
      expect(['layer', 'reference']).toContain(hit.source);
    }
  });

  it('finds a ref-only roads entity (route number, no name) and returns a non-null name', async () => {
    // 24 roads entities in the live dev DB carry a `ref` (route number, e.g.
    // "04/22L", "16", "18B", "19") but no `name` -- exactly the query this
    // feature exists to serve, and the web always requests ref:roads. Picked
    // dynamically, not hardcoded, so this survives a basemap reload.
    await buildReferenceLayer(getPool(), 'roads');
    const { rows } = await getPool().query<{ ref: string }>(
      `SELECT ref FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND name IS NULL AND ref IS NOT NULL
        LIMIT 1`
    );
    expect(rows.length).toBeGreaterThan(0);
    const ref = rows[0].ref;

    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(ref)}&sources=ref:roads`,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as Array<{ name: string; layerKey: string }>;
    const hit = results.find((h) => h.layerKey === 'roads');
    expect(hit).toBeDefined();
    // The whole point: coalesce(name, ref) means a ref-only entity is still
    // searchable and never surfaces a null name to the client.
    expect(hit!.name).not.toBeNull();
    expect(hit!.name).toBe(ref);
  });

  it('rejects an unknown source', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song&sources=ref:roads_vn' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a water layer that has no searchable name column', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song&sources=flood_zones' });
    expect(res.statusCode).toBe(400);
  });

  it('does not 500 on duplicate source tokens (each would otherwise emit the same CTE name twice)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=an&sources=dams,dams' });
    expect(res.statusCode).toBe(200);
    for (const hit of res.json().results) {
      expect(hit.layerKey).toBe('dams');
    }
  });

  it('does not 500 on a mixed duplicate reference source either', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=an&sources=ref:water,ref:water,rivers' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects an explicitly-supplied but empty/unusable sources list with a 400, not a silent empty success', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song&sources=,,,' });
    expect(res.statusCode).toBe(400);
  });
});
