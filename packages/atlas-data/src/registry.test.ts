import { describe, it, expect } from 'vitest';
import { ALL_DATASETS, validateRegistry } from './registry';
import { topologicalOrder } from './graph';

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
});
