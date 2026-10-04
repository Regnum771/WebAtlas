import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { executeStage, hasExecutor } from './index';
import type { Stage } from '../types';

const ctx = { datasetId: 'd', forced: false, supersedeEdits: false, log: () => {} };

describe('executor table', () => {
  it('has an executor for sql', () => {
    expect(hasExecutor('sql')).toBe(true);
  });

  it('has an executor for every declared stage type, load-geojson included', () => {
    for (const type of ['sql', 'run', 'fetch-http', 'publish-geoserver', 'load-geojson'] as const) {
      expect(hasExecutor(type), type).toBe(true);
    }
  });

  it('reports a stage type with no executor by name', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      executeStage(pool, { type: 'no-such-stage' } as unknown as Stage, ctx)
    ).rejects.toThrow(/"no-such-stage" has no executor/);
  });

  it('returns the sql statement as the summary', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    await expect(executeStage(pool, { type: 'sql', statement: 'SELECT 1' }, ctx)).resolves.toEqual({
      summary: 'SELECT 1',
    });
  });
});
