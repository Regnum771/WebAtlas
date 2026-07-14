import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from './server';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('app skeleton', () => {
  it('serves GET /health', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
