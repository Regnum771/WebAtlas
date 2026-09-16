import { describe, it, expect } from 'vitest';
import { stageKey, stageInputHash, stageHashPlan } from './state';
import type { Dataset, Stage } from './types';

const sql = (statement: string): Stage => ({ type: 'sql', statement });

const dataset = (id: string, stages: Stage[], dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  dependsOn,
  stages,
});

describe('stageKey', () => {
  it('combines position and type so two sql stages stay distinguishable', () => {
    expect(stageKey(0, sql('SELECT 1'))).toBe('0:sql');
    expect(stageKey(1, sql('SELECT 1'))).toBe('1:sql');
  });
});

describe('stageInputHash', () => {
  it('is stable for identical input', () => {
    expect(stageInputHash(sql('SELECT 1'), [])).toBe(stageInputHash(sql('SELECT 1'), []));
  });

  it('changes when the stage config changes, which is what marks it stale', () => {
    expect(stageInputHash(sql('SELECT 1'), [])).not.toBe(stageInputHash(sql('SELECT 2'), []));
  });

  it('changes when an upstream hash changes, so dependents rebuild', () => {
    expect(stageInputHash(sql('SELECT 1'), ['a'])).not.toBe(stageInputHash(sql('SELECT 1'), ['b']));
  });

  it('does not depend on the order upstream hashes are supplied', () => {
    expect(stageInputHash(sql('SELECT 1'), ['a', 'b'])).toBe(
      stageInputHash(sql('SELECT 1'), ['b', 'a'])
    );
  });

  it('hashes a function-valued field by source, so editing a column map invalidates it', () => {
    const a: Stage = { type: 'load-geojson', file: 'f', table: 't', columns: (p) => ({ x: p.a }) };
    const b: Stage = { type: 'load-geojson', file: 'f', table: 't', columns: (p) => ({ x: p.b }) };
    expect(stageInputHash(a, [])).not.toBe(stageInputHash(b, []));
  });

  it('ignores the order of keys in the stage object, so a cosmetic reorder does not rebuild', () => {
    const a = { type: 'sql', statement: 'SELECT 1' } as Stage;
    const b = { statement: 'SELECT 1', type: 'sql' } as Stage;
    expect(stageInputHash(a, [])).toBe(stageInputHash(b, []));
  });

  it('distinguishes no upstreams from one upstream with no recorded hash', () => {
    expect(stageInputHash(sql('SELECT 1'), [])).not.toBe(stageInputHash(sql('SELECT 1'), ['']));
  });
});

describe('stageHashPlan', () => {
  it('chains within a dataset: changing stage 0 changes stage 0 AND stage 1', () => {
    const a = [dataset('x', [sql('FETCH A'), sql('LOAD f')])];
    const b = [dataset('x', [sql('FETCH B'), sql('LOAD f')])];
    const planA = stageHashPlan(a);
    const planB = stageHashPlan(b);
    expect(planA.get('x')![0]).not.toBe(planB.get('x')![0]);
    expect(planA.get('x')![1]).not.toBe(planB.get('x')![1]);
  });

  it('changing stage 1 leaves stage 0 unchanged but changes stage 1', () => {
    const a = [dataset('x', [sql('FETCH A'), sql('LOAD f')])];
    const b = [dataset('x', [sql('FETCH A'), sql('LOAD g')])];
    const planA = stageHashPlan(a);
    const planB = stageHashPlan(b);
    expect(planA.get('x')![0]).toBe(planB.get('x')![0]);
    expect(planA.get('x')![1]).not.toBe(planB.get('x')![1]);
  });

  it("changing dem's stage 0 changes contours' stage 0 hash (contours dependsOn dem)", () => {
    const graphA = [
      dataset('dem', [sql('FETCH A'), sql('LOAD dem')]),
      dataset('contours', [sql('DERIVE contours')], ['dem']),
    ];
    const graphB = [
      dataset('dem', [sql('FETCH B'), sql('LOAD dem')]),
      dataset('contours', [sql('DERIVE contours')], ['dem']),
    ];
    const planA = stageHashPlan(graphA);
    const planB = stageHashPlan(graphB);
    expect(planA.get('contours')![0]).not.toBe(planB.get('contours')![0]);
  });

  it('changing an unrelated independent dataset changes nothing in dem or contours', () => {
    const graphA = [
      dataset('dem', [sql('FETCH A'), sql('LOAD dem')]),
      dataset('contours', [sql('DERIVE contours')], ['dem']),
      dataset('rivers', [sql('FETCH R')]),
    ];
    const graphB = [
      dataset('dem', [sql('FETCH A'), sql('LOAD dem')]),
      dataset('contours', [sql('DERIVE contours')], ['dem']),
      dataset('rivers', [sql('FETCH R2')]),
    ];
    const planA = stageHashPlan(graphA);
    const planB = stageHashPlan(graphB);
    expect(planA.get('dem')).toEqual(planB.get('dem'));
    expect(planA.get('contours')).toEqual(planB.get('contours'));
  });

  it('throws naming the dependency when it comes later in the input array (not topological)', () => {
    const graph = [
      dataset('contours', [sql('DERIVE contours')], ['dem']),
      dataset('dem', [sql('FETCH A'), sql('LOAD dem')]),
    ];
    expect(() => stageHashPlan(graph)).toThrow(/dem/);
  });

  it('is deterministic: same descriptors produce an identical plan', () => {
    const build = () => [
      dataset('dem', [sql('FETCH A'), sql('LOAD dem')]),
      dataset('contours', [sql('DERIVE contours')], ['dem']),
    ];
    expect(stageHashPlan(build())).toEqual(stageHashPlan(build()));
  });
});
