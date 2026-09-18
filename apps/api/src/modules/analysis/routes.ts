import type { FastifyInstance } from 'fastify';
import { runAnalysis } from './controller';

/** Own ceiling: an analysis is heavier than a page call, and a user clicking through
 *  toolbar operations should not exhaust the global 100/min for the rest of the API. */
export default async function analysisRoutes(app: FastifyInstance) {
  app.post('/analysis/:op', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, runAnalysis);
}
