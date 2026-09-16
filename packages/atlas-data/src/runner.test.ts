import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBuild } from './runner';
import type { Dataset } from './types';
import type { Pool } from 'pg';

const ds = (id: string, statement: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement }],
});

/**
 * Minimal in-memory stand-in for the state + lineage tables.
 *
 * Deviation from the brief: `upsertLineage` now runs inside a transaction — it calls
 * `pool.connect()`, then issues BEGIN/COMMIT/ROLLBACK and the lineage writes through the
 * returned client, then `client.release()`. The brief's pool only exposed `query`, which
 * would crash every runner test with "pool.connect is not a function". `connect()` here
 * resolves to a client whose `query` is the SAME handler as the pool's `query`, so SQL
 * routed through the client is recognised identically, with a no-op `release`.
 */
function memoryPool() {
  const state = new Map<string, { input_hash: string; status: string }>();
  const steps: string[] = [];
  const executed: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM app.dataset_stage_state')) {
      const row = state.get(`${params![0]}|${params![1]}`);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INTO app.dataset_stage_state')) {
      state.set(`${params![0]}|${params![1]}`, {
        input_hash: params![2] as string,
        status: params![3] as string,
      });
      return { rows: [] };
    }
    if (sql.includes('INTO app.dataset_lineage_step')) {
      steps.push(params![0] as string);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT') || sql.startsWith('REFRESH')) executed.push(sql);
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  return { pool: { query, connect } as unknown as Pool, steps, executed };
}

describe('runBuild', () => {
  let ctx: ReturnType<typeof memoryPool>;
  beforeEach(() => { ctx = memoryPool(); });

  it('executes dependencies before dependents', async () => {
    const report = await runBuild(ctx.pool, [ds('b', 'SELECT 2', ['a']), ds('a', 'SELECT 1')]);
    expect(report.executed).toEqual(['a/0:sql', 'b/0:sql']);
  });

  it('performs the work once when run twice', async () => {
    const graph = [ds('a', 'SELECT 1')];
    await runBuild(ctx.pool, graph);
    const second = await runBuild(ctx.pool, graph);
    expect(second.executed).toEqual([]);
    expect(second.skipped).toEqual(['a/0:sql']);
  });

  it('reruns a stage whose descriptor changed', async () => {
    await runBuild(ctx.pool, [ds('a', 'SELECT 1')]);
    const second = await runBuild(ctx.pool, [ds('a', 'SELECT 999')]);
    expect(second.executed).toEqual(['a/0:sql']);
  });

  it('writes one lineage process step per executed stage, and none for a skip', async () => {
    const graph = [ds('a', 'SELECT 1')];
    await runBuild(ctx.pool, graph);
    expect(ctx.steps).toEqual(['a']);
    await runBuild(ctx.pool, graph);
    expect(ctx.steps).toEqual(['a']);
  });

  it('blocks dependents of a failed stage but not independent branches', async () => {
    const failing = { ...ds('a', 'FAIL ME'), stages: [{ type: 'sql' as const, statement: 'FAIL ME' }] };
    const query = vi.fn(async (sql: string) => {
      if (sql === 'FAIL ME') throw new Error('boom');
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const report = await runBuild(pool, [failing, ds('b', 'SELECT 2', ['a']), ds('c', 'SELECT 3')]);
    expect(report.failed).toEqual(['a/0:sql']);
    expect(report.blocked).toEqual(['b/0:sql']);
    expect(report.executed).toContain('c/0:sql');
  });

  const dsMulti = (id: string, statements: string[], dependsOn?: string[]): Dataset => ({
    id,
    kind: 'derived',
    lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
    dependsOn,
    stages: statements.map((statement) => ({ type: 'sql' as const, statement })),
  });

  it('chains within a dataset: changing stage 0 reruns stage 1 too', async () => {
    await runBuild(ctx.pool, [dsMulti('x', ['FETCH A', 'LOAD f'])]);
    const second = await runBuild(ctx.pool, [dsMulti('x', ['FETCH B', 'LOAD f'])]);
    expect(second.executed).toEqual(['x/0:sql', 'x/1:sql']);
  });

  it('chains across datasets: changing an upstream stage reruns every stage of every dependent', async () => {
    const contours = ds('contours', 'DERIVE contours', ['dem']);
    await runBuild(ctx.pool, [dsMulti('dem', ['FETCH A', 'LOAD dem']), contours]);
    const second = await runBuild(ctx.pool, [dsMulti('dem', ['FETCH B', 'LOAD dem']), contours]);
    expect(second.executed).toEqual(['dem/0:sql', 'dem/1:sql', 'contours/0:sql']);
  });

  it('rebuilds only the affected stages: changing dem stage 1 leaves dem stage 0 and independent datasets alone', async () => {
    const contours = ds('contours', 'DERIVE contours', ['dem']);
    const rivers = ds('rivers', 'FETCH R');
    await runBuild(ctx.pool, [dsMulti('dem', ['FETCH A', 'LOAD dem']), contours, rivers]);
    const second = await runBuild(ctx.pool, [
      dsMulti('dem', ['FETCH A', 'LOAD dem v2']),
      contours,
      rivers,
    ]);
    expect(second.skipped).toEqual(['dem/0:sql', 'rivers/0:sql']);
    expect(second.executed).toEqual(['dem/1:sql', 'contours/0:sql']);
  });

  it('resumes after a mid-dataset failure: the fixed stage and everything after it run once', async () => {
    const state = new Map<string, { input_hash: string; status: string }>();
    const steps: string[] = [];
    let s1: string = 'FAIL ME';
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'FAIL ME') throw new Error('boom in S1');
      if (sql.includes('FROM app.dataset_stage_state')) {
        const row = state.get(`${params![0]}|${params![1]}`);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('INTO app.dataset_stage_state')) {
        state.set(`${params![0]}|${params![1]}`, {
          input_hash: params![2] as string,
          status: params![3] as string,
        });
        return { rows: [] };
      }
      if (sql.includes('INTO app.dataset_lineage_step')) {
        steps.push(params![0] as string);
        return { rows: [] };
      }
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const build = () => [dsMulti('y', ['S0', s1, 'S2'])];

    const first = await runBuild(pool, build());
    expect(first.executed).toEqual(['y/0:sql']);
    expect(first.failed).toEqual(['y/1:sql']);
    expect(first.blocked).toEqual(['y/2:sql']);
    expect(first.errors['y/1:sql']).toContain('boom in S1');

    s1 = 'S1 FIXED';
    const second = await runBuild(pool, build());
    expect(second.skipped).toEqual(['y/0:sql']);
    expect(second.executed).toEqual(['y/1:sql', 'y/2:sql']);
  });

  it('an infrastructure error isolates the dataset without rejecting the build', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_lineage_step') && params?.[0] === 'a') {
        throw new Error('db connection lost');
      }
      if (sql.includes('FROM app.dataset_stage_state')) return { rows: [] };
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const report = await runBuild(pool, [ds('a', 'SELECT 1'), ds('c', 'SELECT 3')]);
    expect(report.executed).toContain('c/0:sql');
    expect(report.failed).toContain('a/0:sql');
    expect(report.errors['a/0:sql']).toContain('db connection lost');
  });

  it('blocks transitively through a chain of dependents', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'FAIL ME') throw new Error('boom');
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const a = ds('a', 'FAIL ME');
    const b = ds('b', 'SELECT 2', ['a']);
    const g = ds('g', 'SELECT 4', ['b']);
    const report = await runBuild(pool, [a, b, g]);
    expect(report.blocked).toEqual(expect.arrayContaining(['b/0:sql', 'g/0:sql']));
  });
});
