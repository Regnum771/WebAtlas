import { describe, it, expect } from 'vitest';
import { resolveLicences } from './lineage';
import type { Dataset } from './types';

const ds = (id: string, licence: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence, sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

// The real case: contours are derived from the DEM, which is FABDEM (non-commercial).
const graph = [
  ds('dem', 'CC-BY-NC-SA-4.0'),
  ds('contours', 'CC-BY-NC-SA-4.0', ['dem']),
  ds('rivers', 'ODbL-1.0'),
  ds('atlas', 'CC0-1.0', ['contours', 'rivers']),
];

describe('resolveLicences', () => {
  it('returns a dataset\'s own licence when it derives from nothing', () => {
    expect(resolveLicences(graph, 'rivers')).toEqual(['ODbL-1.0']);
  });

  it('inherits an upstream licence transitively — contours carry FABDEM\'s terms', () => {
    expect(resolveLicences(graph, 'contours')).toEqual(['CC-BY-NC-SA-4.0']);
  });

  it('accumulates every licence in the ancestry, which is what export must honour', () => {
    expect(resolveLicences(graph, 'atlas')).toEqual([
      'CC-BY-NC-SA-4.0',
      'CC0-1.0',
      'ODbL-1.0',
    ]);
  });

  it('throws on an unknown dataset rather than silently returning nothing', () => {
    expect(() => resolveLicences(graph, 'nope')).toThrow(/nope/);
  });

  it('walks the full ancestry rather than stopping one level up, even when an intermediate dataset has its own distinct licence', () => {
    // contours' own licence (CC0-1.0) differs from its ancestor dem's (CC-BY-NC-SA-4.0).
    // A resolver that only inspected direct dependsOn licences instead of recursing
    // would miss dem's licence entirely.
    const layeredGraph = [
      ds('dem', 'CC-BY-NC-SA-4.0'),
      ds('contours', 'CC0-1.0', ['dem']),
      ds('atlas', 'CC0-1.0', ['contours']),
    ];
    expect(resolveLicences(layeredGraph, 'atlas')).toEqual([
      'CC-BY-NC-SA-4.0',
      'CC0-1.0',
    ]);
  });
});
