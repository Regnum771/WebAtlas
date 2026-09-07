import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createSessionStore, type Turn } from './sessionStore';

const A: Turn[] = [{ role: 'user', content: 'xin chào' }];
const B: Turn[] = [{ role: 'assistant', content: 'chào bạn' }];

describe('createSessionStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns an empty history for an unknown session', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    expect(store.get('s1', 'u1')).toEqual([]);
  });

  it('accumulates turns across calls', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    store.append('s1', 'u1', B);
    expect(store.get('s1', 'u1')).toEqual([...A, ...B]);
  });

  it('keeps sessions of different users apart even under the same id', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('shared-id', 'u1', A);
    // u2 presenting u1's session id must not read u1's conversation.
    expect(store.get('shared-id', 'u2')).toEqual([]);
  });

  it('refuses to append to another user session and starts a fresh one', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('shared-id', 'u1', A);
    store.append('shared-id', 'u2', B);
    expect(store.get('shared-id', 'u1')).toEqual(A);
    expect(store.get('shared-id', 'u2')).toEqual(B);
  });

  it('expires a session once the TTL has elapsed since its last use', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    vi.advanceTimersByTime(1001);
    expect(store.get('s1', 'u1')).toEqual([]);
  });

  it('use refreshes the TTL', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    vi.advanceTimersByTime(800);
    store.append('s1', 'u1', B);
    vi.advanceTimersByTime(800);
    expect(store.get('s1', 'u1')).toHaveLength(2);
  });

  it('drops the oldest turns beyond maxTurns', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 3 });
    for (const n of ['1', '2', '3', '4']) {
      store.append('s1', 'u1', [{ role: 'user', content: n }]);
    }
    expect(store.get('s1', 'u1').map((t) => t.content)).toEqual(['2', '3', '4']);
  });

  it('sweeps expired sessions out of memory rather than leaking them', () => {
    const store = createSessionStore({ ttlMs: 1000, maxTurns: 20 });
    store.append('s1', 'u1', A);
    store.append('s2', 'u2', A);
    expect(store.size()).toBe(2);
    vi.advanceTimersByTime(1001);
    store.get('s3', 'u3');
    expect(store.size()).toBe(0);
  });
});
