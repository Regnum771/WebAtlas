import type { FastifyInstance } from 'fastify';
import { tile, versions } from './controller';

/**
 * Public, like the WFS they replace. Tiles get their own ceiling: one map view requests dozens at
 * once, and the global 100/min limit (plugins/security.ts) would starve the map.
 */
export default async function tilesRoutes(app: FastifyInstance) {
  app.get('/tiles/versions', versions);
  app.get('/tiles/:layer/:z/:x/:y', { config: { rateLimit: { max: 6000, timeWindow: '1 minute' } } }, tile);
}
