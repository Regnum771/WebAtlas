import type { FastifyInstance } from 'fastify';
import { createTimeseries, createUpload, getItem, search } from './controller';
import { copyToMap } from './copy';
import { wmsProxy } from './proxy';

// A map view asks for map images on every pan and zoom: their own budget per address, as /tiles.
const WMS_LIMIT = { rateLimit: { max: 6000, timeWindow: '1 minute' } };

// The catalogue is readable without signing in (published entries); uploading needs an account.
// Multipart is registered in server.ts.
export default async function catalogueRoutes(app: FastifyInstance) {
  const optional = { preHandler: [app.authenticateOptional] };
  const signedIn = { preHandler: [app.authenticate] };
  app.get('/search', optional, search);
  app.post('/uploads', signedIn, createUpload);
  app.post('/timeseries', signedIn, createTimeseries);
  app.get('/:id', optional, getItem);
  app.get('/:id/wms', { ...optional, config: WMS_LIMIT }, wmsProxy);
  app.post('/:id/copy', signedIn, copyToMap);
}
