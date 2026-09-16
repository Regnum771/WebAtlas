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
  const state = new Map<string, string>();
  const steps: string[] = [];
  const executed: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM app.dataset_stage_state')) {
      const hash = state.get(`${params![0]}|${params![1]}`);
      return { rows: hash ? [{ input_hash: hash, status: 'ok' }] : [] };
    }
    if (sql.includes('INTO app.dataset_stage_state')) {
      state.set(`${params![0]}|${params![1]}`, params![2] as string);
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
    expect(report.blocked).toEqual(['b']);
    expect(report.executed).toContain('c/0:sql');
  });
});
