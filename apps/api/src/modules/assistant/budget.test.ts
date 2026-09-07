import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBudget } from './budget';

describe('createBudget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a fresh user as under the ceiling', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    expect(budget.check('u1')).toEqual({ allowed: true, used: 0, limit: 1000 });
  });

  it('accumulates recorded tokens per user', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 400);
    budget.record('u1', 100);
    budget.record('u2', 900);
    expect(budget.check('u1').used).toBe(500);
    expect(budget.check('u2').used).toBe(900);
  });

  it('blocks once the ceiling is reached', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 1000);
    expect(budget.check('u1').allowed).toBe(false);
  });

  it('blocks a user who overshot the ceiling on the last call', () => {
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 1500);
    expect(budget.check('u1')).toEqual({ allowed: false, used: 1500, limit: 1000 });
  });

  it('resets at the UTC day boundary', () => {
    vi.setSystemTime(new Date('2026-09-08T23:59:00Z'));
    const budget = createBudget({ dailyTokens: 1000 });
    budget.record('u1', 1000);
    expect(budget.check('u1').allowed).toBe(false);
    vi.setSystemTime(new Date('2026-09-09T00:01:00Z'));
    expect(budget.check('u1')).toEqual({ allowed: true, used: 0, limit: 1000 });
  });

  it('treats a ceiling of 0 as unlimited so the feature can be run without a cap', () => {
    const budget = createBudget({ dailyTokens: 0 });
    budget.record('u1', 999999);
    expect(budget.check('u1').allowed).toBe(true);
  });
});
