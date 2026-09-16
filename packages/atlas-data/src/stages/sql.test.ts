import { describe, it, expect, vi } from 'vitest';
import { executeSql } from './sql';
import type { Pool } from 'pg';

const fakePool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as Pool;

describe('executeSql', () => {
  it('runs the statement on the pool', async () => {
    const pool = fakePool();
    await executeSql(pool, { type: 'sql', statement: 'SELECT 1' });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('does not wrap the statement in a transaction', async () => {
    // REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction block,
    // and rivers_overview is refreshed exactly that way. Wrapping would break it.
    const pool = fakePool();
    await executeSql(pool, {
      type: 'sql',
      statement: 'REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview',
    });
    const issued = (pool.query as unknown as { mock: { calls: string[][] } }).mock.calls.flat();
    expect(issued).not.toContain('BEGIN');
  });

  it('propagates a failure so the runner can mark the stage failed', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Pool;
    await expect(executeSql(pool, { type: 'sql', statement: 'SELECT 1' })).rejects.toThrow('boom');
  });
});
