import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';

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
