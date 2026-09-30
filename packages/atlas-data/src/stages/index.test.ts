import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { executeStage, hasExecutor } from './index';

const ctx = { datasetId: 'd', forced: false, log: () => {} };

describe('executor table', () => {
  it('has an executor for sql', () => {
    expect(hasExecutor('sql')).toBe(true);
  });

  it('reports a stage type with no executor by name', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      executeStage(pool, { type: 'load-geojson', file: 'f', table: 't', columns: () => ({}) }, ctx)
    ).rejects.toThrow(/"load-geojson" has no executor/);
  });

  it('returns the sql statement as the summary', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    await expect(executeStage(pool, { type: 'sql', statement: 'SELECT 1' }, ctx)).resolves.toEqual({
      summary: 'SELECT 1',
    });
  });
});
