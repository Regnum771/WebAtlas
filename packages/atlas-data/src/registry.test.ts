import { describe, it, expect } from 'vitest';
import { ALL_DATASETS, validateRegistry } from './registry';
import { topologicalOrder } from './graph';
import type { Dataset } from './types';

describe('registry', () => {
  it('holds at least one dataset', () => {
    expect(ALL_DATASETS.length).toBeGreaterThan(0);
  });

  it('every dataset declares a non-empty licence — export depends on it', () => {
    for (const d of ALL_DATASETS) expect(d.lineage.licence.length).toBeGreaterThan(0);
  });

  it('dataset ids are unique', () => {
    const ids = ALL_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the dependency graph is acyclic and fully resolvable', () => {
    expect(() => topologicalOrder(ALL_DATASETS)).not.toThrow();
  });

  it('no escape hatch is overdue for promotion', () => {
    expect(() => validateRegistry()).not.toThrow();
  });

  // I1: validateRegistry must run the zod schema itself — a plain-object descriptor
  // (one that never called defineDataset) must not be able to skip validation.
  it('rejects a plain-object dataset with no stages, naming its id', () => {
    const bad = {
      id: 'bad-empty-stages',
      kind: 'derived',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [],
    } as unknown as Dataset;
    expect(() => validateRegistry([bad])).toThrow(/bad-empty-stages/);
  });

  it('rejects a run stage with an impossible calendar date (2026-02-30), naming its id', () => {
    const bad = {
      id: 'bad-date',
      kind: 'derived',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [
        { type: 'run', in: 'host', argv: ['x'], produces: 'y', promoteTo: 'sql', promoteBy: '2026-02-30' },
      ],
    } as unknown as Dataset;
    expect(() => validateRegistry([bad])).toThrow(/bad-date/);
  });

  it('registers the rivers dataset under its layer key, not "hydrorivers" (spec C-9)', () => {
    const ids = ALL_DATASETS.map((d) => d.id);
    expect(ids).toContain('rivers');
    expect(ids).not.toContain('hydrorivers');
  });

  it('rejects a stage type with no executor at load time, naming the dataset (spec §8)', () => {
    const bad = {
      id: 'bad-no-executor',
      kind: 'vector',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [{ type: 'load-geojson', file: 'f.geojson', table: 't', columns: () => ({}) }],
    } as unknown as Dataset;
    expect(() => validateRegistry([bad])).toThrow(/bad-no-executor.*load-geojson.*no executor/s);
  });

  it('rivers ingests on the host and then publishes rivers_detail', () => {
    const rivers = ALL_DATASETS.find((d) => d.id === 'rivers')!;
    expect(rivers.stages.map((s) => s.type)).toEqual(['run', 'publish-geoserver']);
    expect(rivers.stages[1]).toMatchObject({ layer: 'rivers', nativeName: 'rivers_detail' });
  });

  it('accepts a well-formed single-dataset list', () => {
    const good: Dataset = {
      id: 'demo-like',
      kind: 'derived',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [{ type: 'sql', statement: 'SELECT 1' }],
    };
    expect(() => validateRegistry([good])).not.toThrow();
  });
});
