import { describe, it, expect } from 'vitest';
import { topologicalOrder, withDependencies, withoutDependents } from './graph';
import type { Dataset } from './types';

const ds = (id: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

// contours depends on dem; rivers_overview depends on rivers. Mirrors the real graph.
const graph = [ds('contours', ['dem']), ds('dem'), ds('rivers_overview', ['rivers']), ds('rivers')];

describe('topologicalOrder', () => {
  it('places every dependency before its dependents', () => {
    const order = topologicalOrder(graph).map((d) => d.id);
    expect(order.indexOf('dem')).toBeLessThan(order.indexOf('contours'));
    expect(order.indexOf('rivers')).toBeLessThan(order.indexOf('rivers_overview'));
  });

  it('throws on a cycle rather than looping forever', () => {
    expect(() => topologicalOrder([ds('a', ['b']), ds('b', ['a'])])).toThrow(/cycle/i);
  });

  it('throws when a dependency is not registered, naming the missing id', () => {
    expect(() => topologicalOrder([ds('contours', ['nope'])])).toThrow(/nope/);
  });
});

describe('withDependencies (--only)', () => {
  it('includes the requested dataset and everything it needs', () => {
    const ids = withDependencies(graph, ['contours']).map((d) => d.id).sort();
    expect(ids).toEqual(['contours', 'dem']);
  });
});

describe('withoutDependents (--except)', () => {
  it('excludes the named dataset AND everything downstream of it', () => {
    // Excluding dem must also exclude contours: a dependent cannot be built
    // without its parent (spec §4).
    const ids = withoutDependents(graph, ['dem']).map((d) => d.id).sort();
    expect(ids).toEqual(['rivers', 'rivers_overview']);
  });
});
