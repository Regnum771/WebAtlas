import { describe, it, expect } from 'vitest';
import { defineDataset } from './schema';

const valid = {
  id: 'demo',
  kind: 'derived' as const,
  lineage: {
    statement: 'Synthetic dataset used to prove the runner.',
    licence: 'CC0-1.0',
    sources: [],
  },
  stages: [{ type: 'sql' as const, statement: 'SELECT 1' }],
};

describe('defineDataset', () => {
  it('accepts a well-formed descriptor and returns it', () => {
    expect(defineDataset(valid).id).toBe('demo');
  });

  it('rejects a descriptor with no stages, which could never produce anything', () => {
    expect(() => defineDataset({ ...valid, stages: [] })).toThrow();
  });

  it('rejects lineage with no licence, because export cannot ship an unlicensed layer', () => {
    expect(() =>
      defineDataset({ ...valid, lineage: { ...valid.lineage, licence: '' } })
    ).toThrow();
  });

  it('rejects a run stage missing promoteTo', () => {
    expect(() =>
      defineDataset({
        ...valid,
        // @ts-expect-error deliberately omitting promoteTo
        stages: [{ type: 'run', command: './x.sh', produces: 'out', promoteBy: '2099-01-01' }],
      })
    ).toThrow();
  });

  it('rejects a run stage missing promoteBy', () => {
    expect(() =>
      defineDataset({
        ...valid,
        // @ts-expect-error deliberately omitting promoteBy
        stages: [{ type: 'run', command: './x.sh', produces: 'out', promoteTo: 'fetch-cog' }],
      })
    ).toThrow();
  });
});
