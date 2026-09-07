import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import type { MapContext } from '@webatlas/shared';

let app: ReturnType<typeof buildApp>;
let token: string;

const EMAIL = 'assistant-viewer@webatlas.test';
const PW = 'assistant-pass-123';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

beforeAll(async () => {
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
});
afterAll(async () => {
  const repo = usersRepository(getPool());
  const user = await repo.findByEmailWithHash(EMAIL);
  if (user) await repo.remove(user.id);
  await app.close();
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

  it('answers an authenticated, well-formed request', async () => {
    const res = await post({ sessionId: 's1', message: 'xin chào', mapContext: MAP_CONTEXT });
    // 503 is the correct answer on a machine with no ANTHROPIC_API_KEY set;
    // 200 on one that has it. Both are pass conditions — what must never
    // happen is a 4xx or a 500.
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 503) {
      expect((res.json() as { error: { code: string } }).error.code).toBe('ASSISTANT_UNAVAILABLE');
    } else {
      const body = res.json() as { segments: unknown[]; commands: unknown[]; provenance: unknown[] };
      expect(Array.isArray(body.segments)).toBe(true);
      expect(Array.isArray(body.commands)).toBe(true);
      expect(Array.isArray(body.provenance)).toBe(true);
    }
  });
});
