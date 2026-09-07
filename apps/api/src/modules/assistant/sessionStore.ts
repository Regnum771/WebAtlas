/**
 * Multi-turn memory, in memory, per the spec: not persisted across restarts and
 * not shared between processes. The message array is stored as plain text turns,
 * NOT as raw SDK content blocks — a stored tool_use block would oblige us to
 * store a matching tool_result block or the next request would be rejected, and
 * replaying old tool results teaches the model nothing the fresh call cannot
 * re-derive. History is what was said, not how it was computed.
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  userId: string;
  turns: Turn[];
  lastUsedAt: number;
}

export interface SessionStoreOptions {
  ttlMs: number;
  maxTurns: number;
}

// A session id is client-generated and therefore guessable — two different
// users can legitimately present the same sessionId (accidentally, or one
// probing the other). Keying the map by sessionId alone would let the second
// user's append silently clobber the first user's history under that key, so
// the key is the (userId, sessionId) pair: each user's session under a given
// id lives independently of anyone else's session under that same id.
function key(sessionId: string, userId: string): string {
  return `${userId}:${sessionId}`;
}

export function createSessionStore({ ttlMs, maxTurns }: SessionStoreOptions) {
  const sessions = new Map<string, Session>();

  function sweep(now: number): void {
    for (const [k, s] of sessions) {
      if (now - s.lastUsedAt > ttlMs) sessions.delete(k);
    }
  }

  function live(sessionId: string, userId: string, now: number): Session | undefined {
    const k = key(sessionId, userId);
    const s = sessions.get(k);
    if (!s) return undefined;
    if (now - s.lastUsedAt > ttlMs) {
      sessions.delete(k);
      return undefined;
    }
    return s;
  }

  return {
    get(sessionId: string, userId: string): Turn[] {
      const now = Date.now();
      sweep(now);
      const s = live(sessionId, userId, now);
      if (!s) return [];
      s.lastUsedAt = now;
      return s.turns.slice();
    },

    append(sessionId: string, userId: string, turns: Turn[]): void {
      const now = Date.now();
      sweep(now);
      const existing = live(sessionId, userId, now);
      const s = existing ?? { userId, turns: [], lastUsedAt: now };
      s.turns = [...s.turns, ...turns].slice(-maxTurns);
      s.lastUsedAt = now;
      sessions.set(key(sessionId, userId), s);
    },

    size(): number {
      return sessions.size;
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
