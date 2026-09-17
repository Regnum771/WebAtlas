import Fastify, { type FastifyInstance } from 'fastify';
import errorHandler from './plugins/errorHandler';
import security from './plugins/security';
import dbPlugin from './plugins/db';
import authentication from './plugins/authentication';
import authRoutes from './modules/auth/routes';
import usersRoutes from './modules/users/routes';
import layersRoutes from './modules/layers/routes';
import searchRoutes from './modules/search/routes';
import geometryRoutes from './modules/geometry/routes';
import elevationRoutes from './modules/elevation/routes';
import assistantRoutes from './modules/assistant/routes';
import { closeAssistantPool } from './modules/assistant/sql/pool';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
    genReqId: () => crypto.randomUUID(),
  });

  app.register(errorHandler);
  app.register(security);
  app.register(dbPlugin);
  app.register(authentication);

  // Register the health route inside a child plugin so it loads after the
  // security plugin has resolved; this ensures the global @fastify/rate-limit
  // hook (added asynchronously by `security`) applies to it.
  app.register(async (child) => {
    child.get('/health', async () => ({ status: 'ok' }));
  });

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(usersRoutes, { prefix: '/api/users' });
  app.register(layersRoutes, { prefix: '/api' });
  app.register(searchRoutes, { prefix: '/api' });
  app.register(geometryRoutes, { prefix: '/api' });
  app.register(elevationRoutes, { prefix: '/api' });
  app.register(assistantRoutes, { prefix: '/api' });

  // The assistant's read-only pool is a SEPARATE pg.Pool from app.pg (deliberately
  // — see modules/assistant/sql/pool.ts), so plugins/db.ts's onClose hook does not
  // cover it. Without this, once a run_sql call has lazily created the pool, a
  // graceful shutdown closes app.pg and leaves these connections open until the
  // process exits.
  app.addHook('onClose', async () => {
    await closeAssistantPool();
  });

  return app;
}
