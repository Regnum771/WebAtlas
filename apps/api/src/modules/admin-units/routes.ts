import type { FastifyInstance } from 'fastify';
import { adminUnits } from './controller';

/** Công khai như /api/search: ranh giới hành chính không phải dữ liệu nhạy cảm. */
export default async function adminUnitsRoutes(app: FastifyInstance) {
  app.get('/admin-units', adminUnits);
}
