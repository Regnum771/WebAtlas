import type { FastifyInstance } from 'fastify';
import { search } from './controller';

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search', search);
}
