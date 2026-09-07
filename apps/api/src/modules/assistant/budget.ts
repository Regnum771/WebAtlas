/**
 * Per-user daily token ceiling. The spec's first recorded risk is unbounded
 * per-user API cost; this is the day-one mitigation it asks for.
 *
 * In memory and per process, like the session store: a restart forgives the
 * day's spend. That is a real limit, documented in the runbook, and still far
 * better than no ceiling. Counting resets on the UTC day boundary, not a rolling
 * window, so a user always knows when their allowance returns.
 */
export interface BudgetOptions {
  /** Tokens per user per UTC day. 0 means unlimited. */
  dailyTokens: number;
}

export interface BudgetStatus {
  allowed: boolean;
  used: number;
  limit: number;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function createBudget({ dailyTokens }: BudgetOptions) {
  let day = utcDay(Date.now());
  let used = new Map<string, number>();

  function rollover(): void {
    const today = utcDay(Date.now());
    if (today !== day) {
      day = today;
      used = new Map();
    }
  }

  return {
    check(userId: string): BudgetStatus {
      rollover();
      const spent = used.get(userId) ?? 0;
      return {
        allowed: dailyTokens === 0 || spent < dailyTokens,
        used: spent,
        limit: dailyTokens,
      };
    },

    /** Called after a turn completes, with input + output tokens. */
    record(userId: string, tokens: number): void {
      rollover();
      used.set(userId, (used.get(userId) ?? 0) + tokens);
    },
  };
}

export type Budget = ReturnType<typeof createBudget>;
