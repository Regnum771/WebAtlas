import type { FastifyInstance } from 'fastify';
import { detail, frame, impacts, list, plan, roads } from './controller';

/**
 * Read-only flood scenario demo (docs/superpowers/specs/2026-10-15-flood-scenario-demo-design.md).
 *
 * Every route here has its own ceiling, for the same reason as /elevation: the dock preloads all
 * 137 frames of a scenario at once and asks for impacts as the slider moves, which would exhaust
 * the global 100/minute and lock the user out of the rest of the API.
 */
const OWN_LIMIT = { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } };
export default async function scenariosRoutes(app: FastifyInstance) {
  app.get('/scenarios', OWN_LIMIT, list);
  app.get('/scenarios/:id', OWN_LIMIT, detail);
  app.get('/scenarios/:id/impacts', OWN_LIMIT, impacts);
  app.get('/scenarios/:id/plan', OWN_LIMIT, plan);
  app.get('/scenarios/:id/roads', OWN_LIMIT, roads);
  app.get('/scenarios/:id/frames/:hour', { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } }, frame);
}
