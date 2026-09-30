import type { FastifyInstance } from 'fastify';
import { resolveRoiRoute } from './controller';

/** Every ROI pick and every radius change is one resolve, so the ceiling is above the
 *  analysis route's 60/min: picking and adjusting is quick, clicking "Chạy" is not. */
export default async function roiRoutes(app: FastifyInstance) {
  app.post('/roi/resolve', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, resolveRoiRoute);
}
