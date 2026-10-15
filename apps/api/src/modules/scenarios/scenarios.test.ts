import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../server';
import { getPool, closePool } from '../../db/pool';
import { listScenarios } from './repository';

let app: ReturnType<typeof buildApp>;

/**
 * Whether THIS machine has run packages/atlas-data/tools/flood_scenario/build_scenarios.py
 * (docs/runbooks/flood-scenario-demo.md). Probed at module scope so `skipIf` sees it at
 * collection time (see elevation.test.ts for why beforeAll is too late).
 */
const scenariosBuilt = await (async () => {
  const { rows } = await getPool().query<{ built: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'scenario' AND table_name = 'flood_scenario') AS built`
  );
  return rows[0].built;
})();
if (!scenariosBuilt) console.warn('scenario schema missing: run build_scenarios.py; data tests skipped');

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closePool();
});

describe('listScenarios', () => {
  it('returns an empty list when the scenario schema was never built', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('missing'), { code: '42P01' }); } } as unknown as Pool;
    await expect(listScenarios(pool)).resolves.toEqual([]);
  });
});

describe('GET /api/scenarios', () => {
  it('404s an unknown scenario with a Vietnamese message', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Không có kịch bản lũ này.');
  });

  it('404s the roads of an unknown scenario', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/nope/roads' });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a frame path that is not a scenario id and an integer hour', async () => {
    for (const url of ['/api/scenarios/..%2F..%2Fx/frames/1', '/api/scenarios/kttv-2025-10/frames/abc',
      '/api/scenarios/kttv-2025-10/frames/..%2F..%2Fpackage.json']) {
      const res = await app.inject({ method: 'GET', url });
      expect([400, 404]).toContain(res.statusCode);
      expect(res.headers['content-type']).not.toContain('image/png');
    }
  });

  it.skipIf(!scenariosBuilt)('lists the four scenarios', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { id: string }) => s.id)).toEqual(['kttv-2025-10', 'preset-500', 'preset-1000', 'preset-1300']);
  });

  it.skipIf(!scenariosBuilt)('returns a scenario with 97 levels per station and the frame extent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/kttv-2025-10' });
    const body = res.json();
    expect(body.bulletinHour).toBe(64);
    expect(body.floodplainOffsetM).toBe(1.5);
    expect(body.series['cau-lau'].level).toHaveLength(137);
    expect(Math.max(...body.series['cau-lau'].level)).toBeCloseTo(5.62, 2);
    expect(body.series['cau-lau'].forecast.filter((v: number | null) => v !== null)).toHaveLength(4);
    expect(body.floodedKm2).toHaveLength(137);
    expect(body.frameExtent).toHaveLength(4);
    expect(body.stations.map((s: { id: string }) => s.id)).toContain('hoi-an');
  });

  it.skipIf(!scenariosBuilt)('clamps an impacts hour beyond the scenario to its last hour', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/kttv-2025-10/impacts?hour=999' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hour).toBe(136);
    expect(body.time).toBe('21:00 31/10/2025');
    expect(body.totals.wardsWet).toBe(body.wards.length);
    expect(body.totals.roadsCutKm).toBeGreaterThan(0);
    // No bridge reads as flooded: bridges stand above the water.
    expect(body.roads.some((r: { name: string }) => /^Cầu /.test(r.name))).toBe(false);
  });

  it.skipIf(!scenariosBuilt)('lists major roads before small ones within the same hour', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/kttv-2025-10/impacts?hour=136' });
    const roads = res.json().roads as { cutHour: number; fclass: string }[];
    const rank = (f: string) => (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].some((c) => f.startsWith(c)) ? 0 : 1);
    for (let i = 1; i < roads.length; i++) {
      if (roads[i].cutHour === roads[i - 1].cutHour) expect(rank(roads[i].fclass)).toBeGreaterThanOrEqual(rank(roads[i - 1].fclass));
    }
  });

  it.skipIf(!scenariosBuilt)('returns the plan in priority order from 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/kttv-2025-10/plan' });
    const rows = res.json();
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r: { priority: number }, i: number) => expect(r.priority).toBe(i + 1));
    expect(rows[0].arrow.type).toBe('LineString');
  });

  it.skipIf(!scenariosBuilt)('returns the cut roads as GeoJSON with the hour each is cut', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/kttv-2025-10/roads' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);
    expect(body.features.every((f: { properties: { cutHour: number } }) => Number.isInteger(f.properties.cutHour))).toBe(true);
  });

  it.skipIf(!scenariosBuilt)('serves a frame as a cacheable PNG', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenarios/kttv-2025-10/frames/24' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('max-age=3600');
    // The web app on another origin draws these as images; helmet's default same-origin would block them.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it.skipIf(!scenariosBuilt)('lets the slider ask for impacts more often than the global rate limit allows', async () => {
    for (let i = 0; i < 150; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/scenarios/kttv-2025-10/impacts?hour=${i % 137}` });
      expect(res.statusCode).toBe(200);
    }
  });

  it.skipIf(!scenariosBuilt)('lets a client preload more frames than the global rate limit allows', async () => {
    for (let i = 0; i < 150; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/scenarios/preset-500/frames/${i % 137}` });
      expect(res.statusCode).toBe(200);
    }
  });
});
