import { describe, it, expect } from 'vitest';
import { assertNoOverdueEscapeHatches } from './debt';
import type { Dataset } from './types';

const withRunStage = (promoteBy: string): Dataset => ({
  id: 'dem',
  kind: 'raster',
  lineage: { statement: 's', licence: 'CC-BY-NC-SA-4.0', sources: [] },
  stages: [
    { type: 'run', command: 'prep_dem.py', produces: 'dem.tif', promoteTo: 'fetch-cog', promoteBy },
  ],
});

const TODAY = new Date('2026-09-16T00:00:00Z');

describe('assertNoOverdueEscapeHatches', () => {
  it('passes when the promotion date is still in the future', () => {
    expect(() => assertNoOverdueEscapeHatches([withRunStage('2026-12-31')], TODAY)).not.toThrow();
  });

  it('fails the build when a promotion date has passed', () => {
    expect(() => assertNoOverdueEscapeHatches([withRunStage('2026-01-01')], TODAY)).toThrow(
      /dem.*promoteBy 2026-01-01/s
    );
  });

  it('names every overdue stage, not just the first', () => {
    const a = withRunStage('2026-01-01');
    const b = { ...withRunStage('2026-02-02'), id: 'basemap' };
    expect(() => assertNoOverdueEscapeHatches([a, b], TODAY)).toThrow(/dem[\s\S]*basemap/);
  });

  it('ignores datasets with no run stages', () => {
    const clean: Dataset = {
      id: 'demo',
      kind: 'derived',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [{ type: 'sql', statement: 'SELECT 1' }],
    };
    expect(() => assertNoOverdueEscapeHatches([clean], TODAY)).not.toThrow();
  });
});
