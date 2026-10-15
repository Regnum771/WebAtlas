import type { FastifyInstance } from 'fastify';
import { detail, frame, impacts, list, plan } from './controller';

/**
 * Read-only flood scenario demo (docs/superpowers/specs/2026-10-15-flood-scenario-demo-design.md).
 *
 * The frames route gets its own ceiling for the same reason as /elevation: the dock preloads all
 * 97 frames of a scenario at once, which alone would exhaust the global 100/minute and lock the
 * user out of the rest of the API.
 */
export default async function scenariosRoutes(app: FastifyInstance) {
  app.get('/scenarios', list);
  app.get('/scenarios/:id', detail);
  app.get('/scenarios/:id/impacts', impacts);
  app.get('/scenarios/:id/plan', plan);
  app.get('/scenarios/:id/frames/:hour', { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } }, frame);
}
