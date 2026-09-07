import type { Pool } from 'pg';
import type { AssistantReply, MapContext } from '@webatlas/shared';
import { config } from '../../config/env';
import { createSessionStore } from './sessionStore';
import { createBudget } from './budget';

export const sessionStore = createSessionStore({
  ttlMs: config.ASSISTANT_SESSION_TTL_MS,
  maxTurns: 20,
});

export const budget = createBudget({ dailyTokens: config.ASSISTANT_DAILY_TOKEN_BUDGET });

export interface AssistantDeps {
  pool: Pool;
  userId: string;
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

/**
 * Task 7 replaces this body with the Tool Runner loop. Until then the route,
 * its auth, its validation, its rate limit, the session store and the budget
 * are all exercised end to end without spending a token.
 */
export async function runAssistant(deps: AssistantDeps): Promise<AssistantReply> {
  const history = sessionStore.get(deps.sessionId, deps.userId);
  const reply = `Đã nhận: "${deps.message}" (${history.length} lượt trước đó).`;
  sessionStore.append(deps.sessionId, deps.userId, [
    { role: 'user', content: deps.message },
    { role: 'assistant', content: reply },
  ]);
  return { segments: [{ kind: 'grounded', text: reply }], commands: [], provenance: [] };
}
