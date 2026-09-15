import type { FastifyInstance } from 'fastify';
import { elevation } from './controller';

/**
 * The cursor readout queries this every time the pointer settles, which is a different
 * traffic shape from every other route in the app — hence the per-route ceiling.
 *
 * The global limit is 100/minute (plugins/security.ts). That is the right budget for
 * page-driven calls and completely wrong here: a user doing nothing but moving the mouse
 * around the map would exhaust it in under a minute and then be locked out of the REST
 * OF THE API, because the global limiter keys on the same user. Raising the global
 * ceiling to suit this one endpoint would weaken it everywhere, so the override is local.
 *
 * 600/minute is ten a second sustained — comfortably above what a 250 ms debounce plus
 * the client-side cache can produce, and still a ceiling. The query itself is a
 * single-tile indexed ST_Value, ~1-3 ms.
 */
export default async function elevationRoutes(app: FastifyInstance) {
  app.get('/elevation', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, elevation);
}
