import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../server';

const app = buildApp();
afterAll(async () => { await app.close(); });

describe('security plugins', () => {
  it('sets helmet headers and rate-limit headers on /health', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-frame-options'] ?? res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });
});
