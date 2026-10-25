import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../../authz/assert';
import {
  dictionary, dictionaryLayer, history, manageOnVN, patchAttribute, patchLayer, restore, templateCsv, templateGpkg,
} from './controller';

export default async function dictionaryRoutes(app: FastifyInstance) {
  // Reading is public like /api/admin-units: the dictionary describes layers, not data.
  app.get('/dictionary', dictionary);
  app.get('/dictionary/:layer', dictionaryLayer);
  app.get('/dictionary/:layer/template.csv', templateCsv);
  app.get('/dictionary/:layer/template.gpkg', templateGpkg);

  // Editing and its history: dictionary.manage on VN (admins pass). A user without the
  // permission anywhere gets NO_PERMISSION; one holding it only below VN, OUT_OF_JURISDICTION.
  const canManage = { preHandler: [app.authenticate, requirePermission('dictionary.manage'), manageOnVN] };
  // A static segment: the router prefers it to `/dictionary/:layer`.
  app.get('/dictionary/history', canManage, history);
  app.patch('/dictionary/:layer', canManage, patchLayer);
  app.patch('/dictionary/:layer/:attribute', canManage, patchAttribute);
  app.post('/dictionary/:layer/restore', canManage, restore);
  app.post('/dictionary/:layer/:attribute/restore', canManage, restore);
}
