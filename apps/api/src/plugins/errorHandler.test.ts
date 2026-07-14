import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Fastify from 'fastify';
import errorHandler from './errorHandler';
import { validate } from '../lib/validate';
import { z } from 'zod';
import { ForbiddenError, ConflictError } from '../errors';

const app = Fastify({ logger: false });
beforeAll(async () => {
  await app.register(errorHandler);
  app.get('/forbidden', async () => { throw new ForbiddenError('nope'); });
  app.get('/conflict', async () => { throw new ConflictError('dup'); });
  app.post('/validated', async (req) => validate(z.object({ n: z.number() }), req.body));
  app.get('/boom', async () => { throw new Error('unexpected'); });
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe('error handler', () => {
  it('maps typed errors to their status + shape', async () => {
    const f = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(f.statusCode).toBe(403);
    expect(f.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope' } });
    const c = await app.inject({ method: 'GET', url: '/conflict' });
    expect(c.statusCode).toBe(409);
    expect(c.json().error.code).toBe('CONFLICT');
  });
  it('maps zod validation failure to 400 with details', async () => {
    const res = await app.inject({ method: 'POST', url: '/validated', payload: { n: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details).toBeDefined();
  });
  it('maps unknown errors to 500 without leaking the message', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  it('unmatched route -> 404 shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
