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

describe('stage variants reject unknown keys', () => {
  const withStage = (stage: Record<string, unknown>) => ({ ...valid, stages: [stage] as never });

  it('a publish stage with a lower-case `nativename` typo is rejected', () => {
    expect(() =>
      defineDataset(withStage({ type: 'publish-geoserver', layer: 'rivers', nativename: 'rivers_detail' }))
    ).toThrow(/nativename/);
  });

  it('a fetch stage with a `sha265` typo is rejected, not silently unpinned', () => {
    expect(() =>
      defineDataset(withStage({ type: 'fetch-http', url: 'https://example.org/a.zip', into: 'a.zip', sha265: 'a'.repeat(64) }))
    ).toThrow(/sha265/);
  });

  it('supersedes names whole file names of the family the stage itself belongs to', () => {
    const fetch = (supersedes: string) =>
      withStage({ type: 'fetch-http', url: 'https://example.org/v-261001.zip', into: 'basemap/v-261001.zip', supersedes });
    expect(() => defineDataset(fetch(String.raw`^v-\d{6}\.zip$`))).not.toThrow();
    // Applied to whole names, so it needs no ^ and $ of its own.
    expect(() => defineDataset(fetch(String.raw`v-\d{6}\.zip`))).not.toThrow();
    expect(() => defineDataset(fetch('^v-(\\d{6}\\.zip$'))).toThrow(/not a regular expression/);
    expect(() => defineDataset(fetch(String.raw`^w-\d{6}\.zip$`))).toThrow(/own file name/);
  });

  it('sql and load-geojson stages reject stray keys too', () => {
    expect(() => defineDataset(withStage({ type: 'sql', statement: 'SELECT 1', stmt: 'x' }))).toThrow();
    expect(() =>
      defineDataset(withStage({ type: 'load-geojson', layer: 'dams', versioned: true, files: [{ file: 'a.geojson', columns: () => ({}) }], c: 1 }))
    ).toThrow();
  });

  describe('load-geojson', () => {
    const base = { type: 'load-geojson' as const, layer: 'dams', versioned: true };
    const file = { file: 'seeds/dams.geojson', columns: () => ({}) };
    it('accepts a versioned layer with one file', () => {
      expect(() => defineDataset(withStage({ ...base, files: [file], legacySource: 'thuydienvietnam.geojson' }))).not.toThrow();
    });
    it('a mapping revision is a positive whole number', () => {
      expect(() => defineDataset(withStage({ ...base, files: [file], mappingRevision: 2 }))).not.toThrow();
      for (const bad of [0, -1, 1.5, '2']) {
        expect(() => defineDataset(withStage({ ...base, files: [file], mappingRevision: bad })), String(bad)).toThrow();
      }
    });
    it('rejects no files, a stray key, and a path that leaves its root', () => {
      expect(() => defineDataset(withStage({ ...base, files: [] }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [file], tabel: 't' }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, colums: 1 }] }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, file: '../x.geojson' }] }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, file: '/abs/x.geojson' }] }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, layer: 'dams; DROP', files: [file] }))).toThrow();
    });
    it('a versioned stage may not name a target table, and a non-versioned one must', () => {
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, target: 'admin.provinces' }] }))).toThrow(/target/);
      expect(() => defineDataset(withStage({ ...base, layer: 'admin', versioned: false, files: [file] }))).toThrow(/target/);
      expect(() => defineDataset(withStage({ ...base, layer: 'admin', versioned: false, files: [{ ...file, target: 'admin.provinces' }] }))).not.toThrow();
      expect(() => defineDataset(withStage({ ...base, layer: 'admin', versioned: false, files: [{ ...file, target: 'provinces; DROP' }] }))).toThrow();
    });
  });
});
