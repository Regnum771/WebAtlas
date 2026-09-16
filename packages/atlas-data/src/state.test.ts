import { describe, it, expect } from 'vitest';
import { stageKey, stageInputHash } from './state';
import type { Stage } from './types';

const sql = (statement: string): Stage => ({ type: 'sql', statement });

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
});
