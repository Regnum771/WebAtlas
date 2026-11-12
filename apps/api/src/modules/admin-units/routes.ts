import type { FastifyInstance } from 'fastify';
import { adminUnits, suggestUnit, unitTree } from './controller';

/** Công khai như /api/search: ranh giới hành chính không phải dữ liệu nhạy cảm. */
export default async function adminUnitsRoutes(app: FastifyInstance) {
  app.get('/admin-units', adminUnits);
  // Public too: the unit tree is the same boundary data, and a suggestion only reads it.
  app.get('/admin-units/tree', unitTree);
  app.post('/admin-units/suggest', suggestUnit);
}
