import type { FastifyInstance } from 'fastify';
import { dictionary, dictionaryLayer } from './controller';

/** Public like /api/admin-units: the dictionary describes layers, not data. */
export default async function dictionaryRoutes(app: FastifyInstance) {
  app.get('/dictionary', dictionary);
  app.get('/dictionary/:layer', dictionaryLayer);
}
