import Fastify, { type FastifyInstance } from 'fastify';
import errorHandler from './plugins/errorHandler';
import security from './plugins/security';
import dbPlugin from './plugins/db';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
    genReqId: () => crypto.randomUUID(),
  });

  app.register(errorHandler);
  app.register(security);
  app.register(dbPlugin);

  // Register the health route inside a child plugin so it loads after the
  // security plugin has resolved; this ensures the global @fastify/rate-limit
  // hook (added asynchronously by `security`) applies to it.
  app.register(async (child) => {
    child.get('/health', async () => ({ status: 'ok' }));
  });

  return app;
}
