/**
 * The one place a live model is required: intent routing. Excluded from the
 * default run by filename (vitest.config.ts) because it costs tokens on every
 * execution. Run deliberately with `npm run test:api:live`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { MapCommand, MapContext } from '@webatlas/shared';
import { getPool, closePool } from '../../db/pool';
import { runAssistant, NO_REPLY_FALLBACK } from './service';
import { config } from '../../config/env';
import { buildApp } from '../../server';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const HTTP_EMAIL = 'assistant-live-http@webatlas.test';
const HTTP_PW = 'assistant-live-pass-789';

// This suite never runs without ANTHROPIC_API_KEY (describe.skip below), so a
// real Fastify request logger is not available here — a console-backed stub
// satisfies runAssistant's AssistantDeps.logger without pulling in Fastify.
const testLogger = console as unknown as FastifyBaseLogger;

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

const enabled = Boolean(config.ANTHROPIC_API_KEY);
const maybe = enabled ? describe : describe.skip;

let pool: ReturnType<typeof getPool>;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

function ask(message: string, sessionId = `live-${Math.random()}`) {
  return runAssistant({
    pool,
    userId: 'live-test-user',
    sessionId,
    message,
    mapContext: MAP_CONTEXT,
    logger: testLogger,
  });
}

maybe('intent routing (live model)', () => {
  it('routes a province request to a zoom command', async () => {
    const { commands } = await ask('Chuyển bản đồ tới Đắk Lắk');
    expect(commands.some((c: MapCommand) => c.kind === 'zoomToRegion')).toBe(true);
  }, 60_000);

  it('routes a layer request to a visibility command', async () => {
    const { commands } = await ask('Bật lớp sông ngòi lên giúp tôi');
    expect(commands.some((c: MapCommand) => c.kind === 'setLayerVisible')).toBe(true);
  }, 60_000);

  it('answers a counting question from tool results with provenance', async () => {
    const { provenance, segments } = await ask('Có bao nhiêu đập trong khu vực đang xem?');
    expect(provenance.length).toBeGreaterThan(0);
    expect(segments.some((s) => s.kind === 'grounded')).toBe(true);
    // The fallback is itself a `grounded` segment, so the two assertions above
    // pass even when the real answer was thrown away. Say so explicitly.
    expect(segments.map((s) => s.text).join(' ')).not.toContain(NO_REPLY_FALLBACK);
  }, 60_000);

  it('keeps the prose when it also issues a command in the same turn', async () => {
    // Regression: the model writes its answer alongside a final highlight call,
    // then ends the turn with an empty message once that tool returns. Reading
    // only the last message lost the answer and returned the fallback, while
    // the command and provenance still arrived — so it looked like a refusal.
    // System prompt rule 7 makes naming-features-and-highlighting the norm.
    const { segments, commands, provenance } = await ask('5 đập gần Buôn Ma Thuột nhất?');
    const reply = segments.map((s) => s.text).join(' ');
    expect(reply).not.toContain(NO_REPLY_FALLBACK);
    expect(reply).toMatch(/km/i);
    expect(provenance.some((p) => p.tool === 'nearest_features')).toBe(true);
    expect(commands.some((c: MapCommand) => c.kind === 'highlightFeatures')).toBe(true);
  }, 60_000);

  it('reports missing data instead of inventing it', async () => {
    const { segments } = await ask('Có bao nhiêu trạm quan trắc ở Bắc Kạn?');
    const all = segments.map((s) => s.text).join(' ');
    // Bắc Kạn is outside the working region; the honest answer says so.
    expect(all.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.kind === 'grounded' || s.kind === 'knowledge')).toBe(true);
  }, 60_000);

  it('keeps multi-turn context within one session', async () => {
    const sessionId = `live-multiturn-${Math.random()}`;
    await ask('Chuyển bản đồ tới Đắk Lắk', sessionId);
    const { segments } = await ask('Còn tỉnh nào nữa trong vùng công tác?', sessionId);
    expect(segments.length).toBeGreaterThan(0);
  }, 90_000);

  // The 200 path over real HTTP lives here, not in assistant.route.test.ts:
  // that suite forces the key off so it stays free, which means nothing else
  // proves a well-formed request actually returns a body through the route.
  it('returns a grounded answer over HTTP, not just via runAssistant', async () => {
    const app = buildApp();
    try {
      await app.ready();
      const repo = usersRepository(getPool());
      if (!(await repo.findByEmailWithHash(HTTP_EMAIL))) {
        await repo.insert({
          email: HTTP_EMAIL,
          password_hash: await hashPassword(HTTP_PW),
          full_name: 'assistant-live-http',
          role: 'viewer',
        });
      }
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: HTTP_EMAIL, password: HTTP_PW },
      });
      const httpToken = (login.json() as { token: string }).token;

      const res = await app.inject({
        method: 'POST',
        url: '/api/assistant/messages',
        headers: { authorization: `Bearer ${httpToken}` },
        payload: {
          sessionId: `live-http-${Math.random()}`,
          message: 'Có bao nhiêu đập trong khu vực đang xem?',
          mapContext: MAP_CONTEXT,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { segments: Array<{ text: string }>; provenance: unknown[] };
      expect(body.provenance.length).toBeGreaterThan(0);
      expect(body.segments.map((s) => s.text).join(' ')).not.toContain(NO_REPLY_FALLBACK);

      const user = await repo.findByEmailWithHash(HTTP_EMAIL);
      if (user) await repo.remove(user.id);
    } finally {
      await app.close();
    }
  }, 90_000);
});
