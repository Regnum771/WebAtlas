/**
 * Plumbing only: auth, validation, per-user rate limiting, the 503 gate. This
 * suite must never call the model.
 *
 * It runs with ANTHROPIC_API_KEY forced off (see beforeAll), so every
 * well-formed request short-circuits at the 503 gate — instantly and for free.
 * Without that, a developer machine with a key configured turns `npm run
 * test:api` into a paid run: the rate-limit test below fires up to 40
 * authenticated requests, which became 40 real model calls and a 30s timeout
 * the moment a key was present. The default suite is the free one by design;
 * the model is exercised in assistant.live.test.ts, including over HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { config } from '../../config/env';
import type { MapContext } from '@webatlas/shared';

let app: ReturnType<typeof buildApp>;
let savedApiKey: string | undefined;
let token: string;
let tokenB: string;

const EMAIL = 'assistant-viewer@webatlas.test';
const PW = 'assistant-pass-123';
const EMAIL_B = 'assistant-viewer-b@webatlas.test';
const PW_B = 'assistant-pass-456';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

beforeAll(async () => {
  // Keep this suite free and deterministic regardless of the developer's .env.
  savedApiKey = config.ANTHROPIC_API_KEY;
  config.ANTHROPIC_API_KEY = undefined;

  app = buildApp();
  await app.ready();
  const repo = usersRepository(getPool());
  if (!(await repo.findByEmailWithHash(EMAIL))) {
    await repo.insert({ email: EMAIL, password_hash: await hashPassword(PW), full_name: 'assistant-viewer', role: 'viewer' });
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: EMAIL, password: PW },
  });
  token = (res.json() as { token: string }).token;

  if (!(await repo.findByEmailWithHash(EMAIL_B))) {
    await repo.insert({ email: EMAIL_B, password_hash: await hashPassword(PW_B), full_name: 'assistant-viewer-b', role: 'viewer' });
  }
  const resB = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: EMAIL_B, password: PW_B },
  });
  tokenB = (resB.json() as { token: string }).token;
});
afterAll(async () => {
  const repo = usersRepository(getPool());
  const user = await repo.findByEmailWithHash(EMAIL);
  if (user) await repo.remove(user.id);
  const userB = await repo.findByEmailWithHash(EMAIL_B);
  if (userB) await repo.remove(userB.id);
  await app.close();
  config.ANTHROPIC_API_KEY = savedApiKey;
});

function post(payload: Record<string, unknown>, auth = true) {
  return app.inject({
    method: 'POST',
    url: '/api/assistant/messages',
    headers: auth ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
}

describe('POST /api/assistant/messages', () => {
  it('rejects an anonymous request', async () => {
    const res = await post({ sessionId: 's1', message: 'xin chào', mapContext: MAP_CONTEXT }, false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing message', async () => {
    const res = await post({ sessionId: 's1', mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty message', async () => {
    const res = await post({ sessionId: 's1', message: '   ', mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a message beyond the length cap', async () => {
    const res = await post({ sessionId: 's1', message: 'a'.repeat(2001), mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed bbox', async () => {
    const res = await post({
      sessionId: 's1',
      message: 'xin chào',
      mapContext: { ...MAP_CONTEXT, bbox: [107.5, 12.0, 109.0] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown basemap', async () => {
    const res = await post({
      sessionId: 's1',
      message: 'xin chào',
      mapContext: { ...MAP_CONTEXT, basemap: 'moon' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('carries an authenticated, well-formed request past auth and validation to the 503 gate', async () => {
    // The key is forced off for this suite, so a valid request proves the whole
    // preHandler chain accepted it and it reached the handler — what must never
    // happen is a 4xx (rejected) or a 500 (broken). The 200 path costs tokens
    // and is covered over HTTP in assistant.live.test.ts.
    const res = await post({ sessionId: 's1', message: 'xin chào', mapContext: MAP_CONTEXT });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ASSISTANT_UNAVAILABLE');
  });

  it('rate-limits per user, not per client IP', async () => {
    // app.inject has no real network path, so req.ip is the same constant value
    // for every request in this test — the only thing that can distinguish user
    // A's burst from user B's request is the per-user key. This suite has already
    // sent several authenticated requests as user A above, so we cannot assume a
    // fixed request count triggers the limit; loop (bounded, well under the
    // global 100/min IP limiter) until a 429 is actually observed.
    let sawTooManyRequests = false;
    for (let i = 0; i < 40; i++) {
      const res = await post({ sessionId: 'rl-a', message: 'xin chào', mapContext: MAP_CONTEXT });
      if (res.statusCode === 429) {
        sawTooManyRequests = true;
        break;
      }
    }
    expect(sawTooManyRequests).toBe(true);

    // User B, same client IP, has made no requests yet: must be served, not
    // throttled by user A's burst. This is the assertion that actually fails
    // under the old onRequest-hook bug, where keyGenerator always fell back to
    // req.ip and both users shared one bucket.
    const resB = await app.inject({
      method: 'POST',
      url: '/api/assistant/messages',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { sessionId: 'rl-b', message: 'xin chào', mapContext: MAP_CONTEXT },
    });
    expect(resB.statusCode).not.toBe(429);
  });
});
