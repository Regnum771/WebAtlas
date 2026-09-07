import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import {
  parseReplySegments,
  type AssistantReply,
  type MapCommand,
  type MapContext,
  type Provenance,
} from '@webatlas/shared';
import { config } from '../../config/env';
import { AppError } from '../../errors';
import { createSessionStore } from './sessionStore';
import { createBudget } from './budget';
import { SYSTEM_PROMPT, formatMapContext } from './prompt';
import { buildTools } from './tools/registry';

export const sessionStore = createSessionStore({
  ttlMs: config.ASSISTANT_SESSION_TTL_MS,
  maxTurns: 20,
});

export const budget = createBudget({ dailyTokens: config.ASSISTANT_DAILY_TOKEN_BUDGET });

/** Enough for a paragraph and a few tool calls' worth of confirmations. The
 *  panel is a chat sidebar, not a report generator. */
const MAX_TOKENS = 2048;

/** A question that needs more round trips than this is not going to converge;
 *  each iteration is a paid call. */
const MAX_ITERATIONS = 8;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  // Constructed lazily and once: the constructor reads the key, and building it
  // at module load would make importing this module fail on a machine without one.
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

export interface AssistantDeps {
  pool: Pool;
  userId: string;
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

export async function runAssistant(deps: AssistantDeps): Promise<AssistantReply> {
  const commands: MapCommand[] = [];
  const provenance: Provenance[] = [];

  const tools = buildTools({
    pool: deps.pool,
    mapContext: deps.mapContext,
    collect: (c) => commands.push(c),
    provenance: (p) => provenance.push(p),
  });

  const history = sessionStore.get(deps.sessionId, deps.userId);
  const userTurn = `${deps.message}\n\n${formatMapContext(deps.mapContext)}`;

  const runner = getClient().beta.messages.toolRunner({
    model: config.ASSISTANT_MODEL,
    max_tokens: MAX_TOKENS,
    // The cache breakpoint goes on the last system block. Render order is
    // tools -> system -> messages, so one breakpoint here covers the tool
    // definitions too — and those dominate the prompt, being resent every turn.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: [...history.map((t) => ({ role: t.role, content: t.content })), { role: 'user', content: userTurn }],
    max_iterations: MAX_ITERATIONS,
  });

  let last: Anthropic.Beta.BetaMessage | undefined;
  let tokens = 0;
  try {
    for await (const message of runner) {
      tokens += message.usage.input_tokens + message.usage.output_tokens;
      last = message;
    }
  } catch (e) {
    throw toAppError(e);
  }

  budget.record(deps.userId, tokens);

  const text = (last?.content ?? [])
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const segments = parseReplySegments(
    text || 'Xin lỗi, tôi chưa tạo được câu trả lời cho câu hỏi này.'
  );

  // History stores what was said, not how it was computed: the user's question
  // WITHOUT the map context (which is stale by the next turn and would be sent
  // twice), and the assistant's final text.
  sessionStore.append(deps.sessionId, deps.userId, [
    { role: 'user', content: deps.message },
    { role: 'assistant', content: text },
  ]);

  return { segments, commands, provenance };
}

function toAppError(e: unknown): AppError {
  if (e instanceof Anthropic.RateLimitError) {
    return new AppError(429, 'ASSISTANT_UPSTREAM_BUSY', 'Trợ lý đang quá tải, vui lòng thử lại sau ít phút.');
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new AppError(503, 'ASSISTANT_UNAVAILABLE', 'Trợ lý chưa được cấu hình đúng trên máy chủ này.');
  }
  if (e instanceof Anthropic.APIError) {
    return new AppError(502, 'ASSISTANT_UPSTREAM_ERROR', 'Không kết nối được tới dịch vụ trợ lý.');
  }
  return new AppError(500, 'ASSISTANT_ERROR', 'Trợ lý gặp lỗi khi xử lý câu hỏi.');
}
