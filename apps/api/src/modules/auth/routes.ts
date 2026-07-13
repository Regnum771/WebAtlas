import type { FastifyInstance } from 'fastify';
import { loginHandler, meHandler } from './controller';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, loginHandler);
  app.get('/me', { preHandler: app.authenticate }, meHandler);
}
