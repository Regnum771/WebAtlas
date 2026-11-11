import type { FastifyInstance } from 'fastify';
import { platformServices } from './services';

/** Public: the hub and the top bar show these links to visitors too. */
export default async function platformRoutes(app: FastifyInstance) {
  const list = platformServices();
  app.get('/platform/services', async () => ({ services: await list() }));
}
