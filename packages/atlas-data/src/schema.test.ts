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
        stages: [{ type: 'run', in: 'host', argv: ['./x.sh'], produces: 'out', promoteBy: '2099-01-01' }],
      })
    ).toThrow();
  });

  it('rejects a run stage missing promoteBy', () => {
    expect(() =>
      defineDataset({
        ...valid,
        // @ts-expect-error deliberately omitting promoteBy
        stages: [{ type: 'run', in: 'host', argv: ['./x.sh'], produces: 'out', promoteTo: 'fetch-cog' }],
      })
    ).toThrow();
  });

  it('rejects a run stage whose promoteBy is not a real calendar date (I1)', () => {
    expect(() =>
      defineDataset({
        ...valid,
        stages: [
          {
            type: 'run',
            in: 'host', argv: ['./x.sh'],
            produces: 'out',
            promoteTo: 'fetch-cog',
            promoteBy: '2026-02-30',
          },
        ],
      })
    ).toThrow();
  });
});

describe('run stage argv (spec §7)', () => {
  const run = (extra: Record<string, unknown>) => ({
    ...valid,
    stages: [{ type: 'run', produces: 'out', promoteTo: 'sql', promoteBy: '2099-01-01', ...extra }],
  });

  it('accepts in + argv', () => {
    expect(() => defineDataset(run({ in: 'host', argv: ['run', 'x'] }) as never)).not.toThrow();
  });

  it('rejects a leftover command string even beside a valid argv (a shell would re-parse it)', () => {
    // in + argv are valid, so only .strict() can reject this; the Step 8 mutation relies on it.
    expect(() => defineDataset(run({ in: 'host', argv: ['x'], command: 'npm run x' }) as never)).toThrow();
  });

  it('rejects an empty argv', () => {
    expect(() => defineDataset(run({ in: 'tools', argv: [] }) as never)).toThrow();
  });

  it('rejects an unknown execution place', () => {
    expect(() => defineDataset(run({ in: 'cloud', argv: ['x'] }) as never)).toThrow();
  });
});

describe('fetch-http into (spec §8: downloads stay inside data/cache)', () => {
  const fetchStage = (into: string) => ({
    ...valid,
    stages: [{ type: 'fetch-http' as const, url: 'https://example.org/a.zip', into }],
  });

  it('accepts a relative path', () => {
    expect(() => defineDataset(fetchStage('basemap/vietnam.zip'))).not.toThrow();
  });

  it.each(['../escape.zip', 'a/../../escape.zip', '/abs/path.zip', 'C:\\abs\\path.zip', 'a\\..\\..\\x', 'D:evil.zip', 'C:'])(
    'rejects %s',
    (into) => {
      expect(() => defineDataset(fetchStage(into))).toThrow();
    }
  );
});

describe('publish-geoserver nativeName', () => {
  const pub = (nativeName: string) => ({
    ...valid,
    stages: [{ type: 'publish-geoserver' as const, layer: 'rivers', nativeName }],
  });

  it('rejects an empty nativeName', () => {
    expect(() => defineDataset(pub(''))).toThrow();
  });

  it('accepts a non-empty nativeName', () => {
    expect(() => defineDataset(pub('rivers_detail'))).not.toThrow();
  });
});
