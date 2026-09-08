import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
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
  /** The route's per-request logger, threaded through so the original
   *  Anthropic error can be logged before toAppError() discards its detail. */
  logger: FastifyBaseLogger;
}

/**
 * Tokens actually billed for one API response. The SDK's own doc comment on
 * `usage` states the rule: total input tokens is the summation of
 * `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`
 * — all three are real input, not just the first. This matters especially
 * here: the system block carries a cache breakpoint specifically because the
 * tool definitions dominate the prompt and are resent every turn, so on most
 * iterations the bulk of real input tokens arrives as `cache_read_input_tokens`.
 * Dropping it would let a cache-heavy conversation blow past the daily
 * ceiling while the tracker still reports headroom.
 *
 * The cache fields are typed nullable by the SDK (absent when caching wasn't
 * used on that call), so they are coalesced to 0 rather than left to poison
 * the sum with `undefined`.
 */
export function usageTokens(usage: {
  input_tokens: number | null;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

/**
 * Shown only when the model genuinely produced no text at all. Exported so the
 * live suite can assert a reply is NOT this — the earlier version of that test
 * checked only that provenance existed and that some segment was `grounded`,
 * and this fallback satisfies both, so it passed while real answers were being
 * discarded.
 */
export const NO_REPLY_FALLBACK = 'Xin lỗi, tôi chưa tạo được câu trả lời cho câu hỏi này.';

/**
 * Everything the assistant said this turn, in order.
 *
 * Reads EVERY message the runner yielded, not just the last one. The model
 * routinely writes its answer in the same message as a final tool call, then
 * ends the turn with an empty message once that tool returns. Observed live on
 * "5 dap gan Buon Ma Thuot nhat?": the ranked list sat in message 2 of 3, and
 * message 3 was end_turn with no content at all. Reading only the last message
 * discarded the answer and showed the no-reply fallback, while commands and
 * provenance (collected inside the tools) still came through — so the failure
 * looked like the model refusing rather than a bug here.
 *
 * This is the common path, not an edge case: system prompt rule 7 tells the
 * model to highlight the features it names, so any answer naming features ends
 * on a tool call with nothing left to say.
 */
export function collectReplyText(messages: Anthropic.Beta.BetaMessage[]): string {
  return messages
    .flatMap((m) => m.content)
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .filter((t) => t.length > 0)
    .join('\n');
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

  const turnMessages: Anthropic.Beta.BetaMessage[] = [];
  // A tool runner iteration is a separate API call that resends the whole
  // prompt, so input tokens legitimately recur across iterations — summing
  // them is correct, not double-counting, because that is what was actually
  // billed for each call.
  let tokens = 0;
  try {
    for await (const message of runner) {
      tokens += usageTokens(message.usage);
      turnMessages.push(message);
    }
  } catch (e) {
    // Log the original error here, before toAppError() below replaces it with
    // a generic AppError: the errorHandler plugin only logs the AppError it
    // receives, so anything Anthropic actually said (rate limit detail, an
    // APIError's status/message) would otherwise never reach the log — a
    // production 502 ASSISTANT_UPSTREAM_ERROR would leave no trace of why.
    deps.logger.error({ err: e }, 'Assistant model call failed');
    throw toAppError(e);
  } finally {
    // Charge whatever was actually spent even when a later iteration throws:
    // iterations 1..k-1 were real, billed calls, and discarding their tokens
    // here would let repeated failures spend against the budget for free.
    budget.record(deps.userId, tokens);
  }

  const text = collectReplyText(turnMessages);

  const segments = parseReplySegments(text || NO_REPLY_FALLBACK);

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
