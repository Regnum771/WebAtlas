import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBuild } from './runner';

// Calls through to the real executeStage; the wrapper only records the context each stage was given.
vi.mock('./stages/index', async (original) => {
  const actual = await original<typeof import('./stages/index')>();
  return { ...actual, executeStage: vi.fn(actual.executeStage) };
});
import { executeStage } from './stages/index';
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
function memoryPool(
  opts: {
    failDelete?: boolean;
    failStatement?: string;
    onExecute?: (sql: string, state: Map<string, { input_hash: string; status: string }>) => void;
  } = {}
) {
  const state = new Map<string, { input_hash: string; status: string }>();
  const steps: string[] = [];
  const executed: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    // Must precede the read branch below: the DELETE also contains "FROM app.dataset_stage_state".
    if (sql.startsWith('DELETE FROM app.dataset_stage_state')) {
      if (opts.failDelete) throw new Error('invalidation failed');
      const [id, later, deps] = params as [string, string[], string[]];
      for (const k of [...state.keys()]) {
        const [ds, st] = k.split('|');
        if ((ds === id && later.includes(st)) || deps.includes(ds)) state.delete(k);
      }
      return { rows: [] };
    }
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
    if (opts.failStatement && sql === opts.failStatement) throw new Error('boom');
    if (sql.startsWith('SELECT') || sql.startsWith('REFRESH')) {
      opts.onExecute?.(sql, state);
      executed.push(sql);
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  return { pool: { query, connect } as unknown as Pool, steps, executed, state };
}

describe('runBuild', () => {
  it('records the executed statement in the process step, not just "completed" (I4)', async () => {
    const stepRows: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_lineage_step')) stepRows.push(params![1] as string);
      return { rows: [] };
    });
    const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
    await runBuild(pool, [ds('a', 'SELECT 42')]);
    expect(stepRows).toHaveLength(1);
    expect(stepRows[0]).toMatch(/^stage 0:sql · [0-9a-f]{12} · SELECT 42$/);
  });

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
    // S1's statement never changes across runs — only this flag does. That is what
    // proves the skip decision reads `status`, not just the hash: if the status check
    // were dropped, S1 would look "current" (same hash as the failed write) and never
    // rerun. See R2-I1.
    let failS1 = true;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'S1' && failS1) throw new Error('boom in S1');
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

    const build = () => [dsMulti('y', ['S0', 'S1', 'S2'])];

    const first = await runBuild(pool, build());
    expect(first.executed).toEqual(['y/0:sql']);
    expect(first.failed).toEqual(['y/1:sql']);
    expect(first.blocked).toEqual(['y/2:sql']);
    expect(first.errors['y/1:sql']).toContain('boom in S1');

    failS1 = false;
    const second = await runBuild(pool, build());
    expect(second.skipped).toEqual(['y/0:sql']);
    expect(second.executed).toEqual(['y/1:sql', 'y/2:sql']);
  });

  it('records "stage executed but recording failed" when appendProcessStep throws after a successful execution', async () => {
    const state = new Map<string, { input_hash: string; status: string }>();
    const steps: string[] = [];
    let failStep = true;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_lineage_step')) {
        if (failStep) throw new Error('step write boom');
        steps.push(params![0] as string);
        return { rows: [] };
      }
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
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const graph = [ds('a', 'SELECT 1')];
    const first = await runBuild(pool, graph);
    expect(first.failed).toEqual(['a/0:sql']);
    expect(first.errors['a/0:sql']).toMatch(/^stage executed but recording failed: /);
    expect(state.get('a|0:sql')?.status).not.toBe('ok');

    failStep = false;
    const second = await runBuild(pool, graph);
    expect(second.executed).toEqual(['a/0:sql']);
    expect(steps).toEqual(['a']);
  });

  it('records "stage executed but recording failed" when writeStageState(ok) throws after a successful execution', async () => {
    const state = new Map<string, { input_hash: string; status: string }>();
    const steps: string[] = [];
    let failWrite = true;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_stage_state')) {
        if (params![3] === 'ok' && failWrite) throw new Error('state write boom');
        state.set(`${params![0]}|${params![1]}`, {
          input_hash: params![2] as string,
          status: params![3] as string,
        });
        return { rows: [] };
      }
      if (sql.includes('FROM app.dataset_stage_state')) {
        const row = state.get(`${params![0]}|${params![1]}`);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('INTO app.dataset_lineage_step')) {
        steps.push(params![0] as string);
        return { rows: [] };
      }
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const graph = [ds('a', 'SELECT 1')];
    const first = await runBuild(pool, graph);
    expect(first.failed).toEqual(['a/0:sql']);
    expect(first.errors['a/0:sql']).toMatch(/^stage executed but recording failed: /);
    // The process step was recorded even though the state write failed — over-recording
    // a re-execution is acceptable, under-recording one is not.
    expect(steps).toEqual(['a']);
    expect(state.get('a|0:sql')?.status).not.toBe('ok');

    failWrite = false;
    const second = await runBuild(pool, graph);
    expect(second.executed).toEqual(['a/0:sql']);
    expect(steps).toEqual(['a', 'a']);
  });

  it('an infrastructure error isolates the dataset and blocks its dependents without rejecting the build', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_lineage_step') && params?.[0] === 'a') {
        throw new Error('db connection lost');
      }
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const report = await runBuild(pool, [
      ds('a', 'SELECT 1'),
      ds('b', 'SELECT 2', ['a']),
      ds('c', 'SELECT 3'),
    ]);
    expect(report.executed).toContain('c/0:sql');
    expect(report.failed).toContain('a/0:sql');
    expect(report.errors['a/0:sql']).toContain('db connection lost');
    expect(report.blocked).toContain('b/0:sql');
  });

  it('an upsertLineage failure blocks all of that dataset\'s stages and its dependents', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('app.dataset_lineage (') && params?.[0] === 'a') {
        throw new Error('lineage insert boom');
      }
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const a = dsMulti('a', ['S0', 'S1']);
    const b = ds('b', 'SELECT 2', ['a']);
    const report = await runBuild(pool, [a, b]);
    expect(report.failed).toEqual(['a/lineage']);
    expect(report.errors['a/lineage']).toContain('lineage insert boom');
    expect(report.blocked).toEqual(expect.arrayContaining(['a/0:sql', 'a/1:sql', 'b/0:sql']));
  });

  it('keeps the original execution error when the best-effort failed-state write also throws', async () => {
    // The first `failed` write is the one made before the stage runs; it succeeds. The second is
    // the best-effort write in the catch, after the stage threw.
    let failedWrites = 0;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'FAIL ME') throw new Error('original boom');
      if (sql.includes('INTO app.dataset_stage_state') && params?.[3] === 'failed' && ++failedWrites > 1) {
        throw new Error('state write also boom');
      }
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const report = await runBuild(pool, [ds('a', 'FAIL ME')]);
    expect(report.failed).toEqual(['a/0:sql']);
    expect(report.errors['a/0:sql']).toBe('original boom');
    expect(failedWrites).toBe(2);
  });

  it('does not execute a stage whose state cannot be marked failed first', async () => {
    const executed: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_stage_state') && params?.[3] === 'failed') {
        throw new Error('state write boom');
      }
      if (sql === 'SELECT 7') executed.push(sql);
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { query, connect } as unknown as Pool;

    const report = await runBuild(pool, [ds('a', 'SELECT 7')]);
    expect(executed).toEqual([]);
    expect(report.failed).toEqual(['a/0:sql']);
    expect(report.errors['a/0:sql']).toBe('state write boom');
  });

  it('refuses a load whose file is absent before invalidating anything, so restoring the file rebuilds nothing', async () => {
    const load: Dataset = {
      id: 'dams', kind: 'vector', lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [
        { type: 'load-geojson', layer: 'dams', versioned: true, files: [{ file: 'seeds/__absent__.geojson', columns: () => ({}) }] },
        { type: 'sql', statement: 'SELECT 1' },
      ],
    };
    const p = memoryPool();
    p.state.set('dams|1:sql', { input_hash: 'old', status: 'ok' });
    p.state.set('later|0:sql', { input_hash: 'old', status: 'ok' });
    vi.mocked(executeStage).mockClear();
    const report = await runBuild(p.pool, [load, ds('later', 'SELECT 2', ['dams'])]);
    expect(report.failed).toEqual(['dams/0:load-geojson']);
    expect(report.errors['dams/0:load-geojson']).toMatch(/missing input .*__absent__\.geojson; nothing was invalidated/);
    expect(report.blocked).toEqual(['dams/1:sql', 'later/0:sql']);
    expect(executeStage).not.toHaveBeenCalled();
    // Every row as it was: no failed mark, no invalidation of the later stage or the dependent.
    expect([...p.state.entries()]).toEqual([
      ['dams|1:sql', { input_hash: 'old', status: 'ok' }],
      ['later|0:sql', { input_hash: 'old', status: 'ok' }],
    ]);
  });

  it('tells a stage whether its dataset may supersede steward edits', async () => {
    vi.mocked(executeStage).mockClear();
    const { pool } = memoryPool();
    await runBuild(pool, [ds('a', 'SELECT 1'), ds('b', 'SELECT 2')], { supersedeEdits: ['b'] });
    const seen = vi.mocked(executeStage).mock.calls.map(([, , c]) => [c.datasetId, c.supersedeEdits]);
    expect(seen).toEqual([['a', false], ['b', true]]);
  });

  it('never supersedes edits because a dataset was forced', async () => {
    vi.mocked(executeStage).mockClear();
    const { pool } = memoryPool();
    await runBuild(pool, [ds('a', 'SELECT 1')], { force: ['a'] });
    expect(vi.mocked(executeStage).mock.calls.map(([, , c]) => [c.forced, c.supersedeEdits])).toEqual([[true, false]]);
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

  describe('cascade (I3) — shaped like dem → contours', () => {
    const twoStage = (id: string, a: string, b: string, dependsOn?: string[]): Dataset => ({
      ...ds(id, a, dependsOn),
      stages: [{ type: 'sql', statement: a }, { type: 'sql', statement: b }],
    });
    const dem = () => twoStage('dem', 'SELECT 1', 'SELECT 2');
    const contours = () => ds('contours', 'SELECT 3', ['dem']);

    it('forcing the upstream re-runs its later stages and its dependent', async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      const second = await runBuild(ctx.pool, [dem(), contours()], { force: ['dem'] });
      expect(second.executed).toEqual(['dem/0:sql', 'dem/1:sql', 'contours/0:sql']);
    });

    it('invalidates a dependent that is excluded from this build, via the universe', async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      await runBuild(ctx.pool, [dem()], { force: ['dem'], universe: [dem(), contours()] });
      expect(ctx.state.has('contours|0:sql')).toBe(false);
      expect(ctx.state.get('dem|1:sql')?.status).toBe('ok');
    });

    it('a skip invalidates nothing', async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      const second = await runBuild(ctx.pool, [dem(), contours()]);
      expect(second.executed).toEqual([]);
      expect(ctx.state.get('contours|0:sql')?.status).toBe('ok');
    });

    it("leaves the dependent's state gone when a forced upstream fails mid-way", async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      const failing = memoryPool({ failStatement: 'SELECT 2' });
      // Seed the failing pool with the successful state first.
      for (const [k, v] of ctx.state) failing.state.set(k, v);
      const report = await runBuild(failing.pool, [dem(), contours()], { force: ['dem'] });
      expect(report.failed).toEqual(['dem/1:sql']);
      expect(report.blocked).toContain('contours/0:sql');
      expect(failing.state.has('contours|0:sql')).toBe(false);
    });

    it('marks the running stage failed before it executes, so a killed runner cannot leave it ok or untracked', async () => {
      // A forced stage re-runs at an unchanged hash. If the runner dies mid-stage (Ctrl-C during a
      // five-minute load) nothing runs the catch below, so the row must already say `failed`:
      // left `ok`, the next plain build skips a half-done stage; deleted, the dataset can end up
      // with no rows at all, which is exactly what atlas:adopt records as built.
      const during: Array<string | undefined> = [];
      const p = memoryPool({
        onExecute: (sql, state) => {
          if (sql === 'SELECT 1') during.push(state.get('dem|0:sql')?.status);
        },
      });
      await runBuild(p.pool, [dem()]);
      await runBuild(p.pool, [dem()], { force: ['dem'] });
      // First build (no prior row) and forced rebuild (prior row `ok`) alike.
      expect(during).toEqual(['failed', 'failed']);
      expect(p.state.get('dem|0:sql')?.status).toBe('ok');
    });

    it('does not execute a stage whose invalidation failed', async () => {
      const failing = memoryPool({ failDelete: true });
      const report = await runBuild(failing.pool, [ds('a', 'SELECT 7')]);
      expect(failing.executed).toEqual([]);
      expect(report.failed).toEqual(['a/0:sql']);
      expect(report.errors['a/0:sql']).toMatch(/invalidation failed/);
    });
  });
});
