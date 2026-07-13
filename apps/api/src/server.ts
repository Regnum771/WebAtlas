import Fastify, { type FastifyInstance } from 'fastify';
import dbPlugin from './plugins/db';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
    genReqId: () => crypto.randomUUID(),
  });

  app.register(dbPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
