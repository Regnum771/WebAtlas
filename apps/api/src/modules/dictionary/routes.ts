import type { FastifyInstance } from 'fastify';
import { dictionary, dictionaryLayer, templateCsv, templateGpkg } from './controller';

/** Public like /api/admin-units: the dictionary describes layers, not data. */
export default async function dictionaryRoutes(app: FastifyInstance) {
  app.get('/dictionary', dictionary);
  app.get('/dictionary/:layer', dictionaryLayer);
  app.get('/dictionary/:layer/template.csv', templateCsv);
  app.get('/dictionary/:layer/template.gpkg', templateGpkg);
}
