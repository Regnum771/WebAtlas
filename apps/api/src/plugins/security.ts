import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env';

// Registered via fastify-plugin so helmet/cors/rate-limit hooks attach to the
// root instance. The global rate-limit hook is wired asynchronously, so routes
// must be registered after this plugin resolves (see server.ts).
export default fp(async (app) => {
  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
});
