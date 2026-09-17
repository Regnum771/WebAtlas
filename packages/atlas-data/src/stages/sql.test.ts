import { describe, it, expect, vi } from 'vitest';
import { executeSql } from './sql';
import type { Pool } from 'pg';

/**
 * A fake pool with a connect() that returns a fake client, so a hidden
 * pool.connect() + client.query('BEGIN') transaction can't hide from the
 * "no transaction" test below.
 */
const fakePool = () => {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  return { pool: pool as unknown as Pool, client };
};

describe('executeSql', () => {
  it('runs the statement on the pool', async () => {
    const { pool } = fakePool();
    await executeSql(pool, { type: 'sql', statement: 'SELECT 1' });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('does not wrap the statement in a transaction', async () => {
    // REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction block,
    // and rivers_overview is refreshed exactly that way. Wrapping would break it —
    // whether that wrapping goes through pool.query('BEGIN') or through
    // pool.connect() + client.query('BEGIN').
    const { pool, client } = fakePool();
    await executeSql(pool, {
      type: 'sql',
      statement: 'REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview',
    });

    expect(pool.connect).not.toHaveBeenCalled();

    const poolCalls = (pool.query as unknown as { mock: { calls: string[][] } }).mock.calls.flat();
    const clientCalls = (client.query as unknown as { mock: { calls: string[][] } }).mock.calls.flat();
    expect([...poolCalls, ...clientCalls]).not.toContain('BEGIN');
  });

  it('propagates a failure so the runner can mark the stage failed', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Pool;
    await expect(executeSql(pool, { type: 'sql', statement: 'SELECT 1' })).rejects.toThrow('boom');
  });
});
