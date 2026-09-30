import { describe, it, expect } from 'vitest';
import { formatStatus, type DatasetStatus } from './status';

const row = (id: string, ...stages: Array<[string, DatasetStatus['state']]>): DatasetStatus => {
  const order = ['failed', 'missing', 'stale', 'ok'] as const;
  const state = order.find((s) => stages.some(([, st]) => st === s)) ?? 'ok';
  return { id, state, stages: stages.map(([key, st]) => ({ key, state: st })) };
};

describe('formatStatus (spec U-4)', () => {
  it('groups worst-first, names the unhealthy stages, and suggests one next command', () => {
    const lines = formatStatus([
      row('demo', ['0:sql', 'ok']),
      row('basemap', ['0:fetch-http', 'missing'], ['1:run', 'missing']),
      row('rivers', ['0:run', 'stale'], ['1:publish-geoserver', 'ok']),
    ]);
    expect(lines).toEqual([
      'missing basemap',
      '          basemap: 0:fetch-http missing, 1:run missing',
      'stale   rivers',
      '          rivers: 0:run stale',
      'ok      demo',
      'next: npm run atlas:build   (or npm run atlas:adopt first, if this machine already holds the data)',
    ]);
  });

  it('points a failure at a targeted retry', () => {
    const lines = formatStatus([row('dem', ['0:run', 'ok'], ['1:run', 'failed'])]);
    expect(lines.at(-1)).toBe('next: npm run atlas:build -- --only dem   (retries the failed stage; the build output has the error)');
  });

  it('when everything is built, suggests verifying it serves', () => {
    expect(formatStatus([row('demo', ['0:sql', 'ok'])]).at(-1)).toBe(
      'next: npm run atlas:verify   (everything is recorded as built; check it actually serves)'
    );
  });
});

describe('computeStatus', () => {
  it('reads each stage as ok, stale (hash moved), failed or missing', async () => {
    const { vi } = await import('vitest');
    const { stageHashPlan } = await import('./state');
    const { computeStatus } = await import('./status');
    const d = {
      id: 'x', kind: 'derived' as const, lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [0, 1, 2, 3].map((i) => ({ type: 'sql' as const, statement: `SELECT ${i}` })),
    };
    const h = stageHashPlan([d]).get('x')!;
    const rows: Record<string, { input_hash: string; status: string }> = {
      '0:sql': { input_hash: h[0], status: 'ok' },
      '1:sql': { input_hash: 'an older hash', status: 'ok' },
      '2:sql': { input_hash: h[2], status: 'failed' },
    };
    const pool = {
      query: vi.fn(async (_sql: string, params: unknown[]) => ({ rows: rows[params[1] as string] ? [rows[params[1] as string]] : [] })),
    } as unknown as import('pg').Pool;
    const [s] = await computeStatus(pool, [d]);
    expect(s.stages.map((st) => st.state)).toEqual(['ok', 'stale', 'failed', 'missing']);
    expect(s.state).toBe('failed');
  });

  it('a failed row wins over a moved hash', async () => {
    const { vi } = await import('vitest');
    const { computeStatus } = await import('./status');
    const d = {
      id: 'y', kind: 'derived' as const, lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [{ type: 'sql' as const, statement: 'SELECT 1' }],
    };
    const pool = {
      query: vi.fn(async () => ({ rows: [{ input_hash: 'an older hash', status: 'failed' }] })),
    } as unknown as import('pg').Pool;
    const [s] = await computeStatus(pool, [d]);
    expect(s.stages.map((st) => st.state)).toEqual(['failed']);
  });
});
