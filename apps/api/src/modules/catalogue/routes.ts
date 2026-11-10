import type { FastifyInstance } from 'fastify';
import { createTimeseries, createUpload, getItem, search } from './controller';

// The catalogue is readable without signing in (published entries); uploading needs an account.
// Multipart is registered in server.ts.
export default async function catalogueRoutes(app: FastifyInstance) {
  const optional = { preHandler: [app.authenticateOptional] };
  const signedIn = { preHandler: [app.authenticate] };
  app.get('/search', optional, search);
  app.post('/uploads', signedIn, createUpload);
  app.post('/timeseries', signedIn, createTimeseries);
  app.get('/:id', optional, getItem);
}
