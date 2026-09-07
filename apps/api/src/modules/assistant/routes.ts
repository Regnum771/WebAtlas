import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { CAN_READ_FEATURES } from '../../hooks/capabilities';
import { postMessage } from './controller';

export default async function assistantRoutes(app: FastifyInstance) {
  app.post(
    '/assistant/messages',
    {
      preHandler: [app.authenticate, authorize(...CAN_READ_FEATURES)],
      config: {
        // Tighter than the global 100/min and keyed per user rather than per IP:
        // every message costs API tokens, and a shared office IP must not let one
        // user's burst throttle the rest. The daily ceiling in budget.ts is the
        // cost bound; this is the burst bound.
        //
        // hook must be 'preHandler': @fastify/rate-limit defaults to running its
        // check on 'onRequest', which fires before this route's own preHandler
        // chain (app.authenticate) has had a chance to set req.currentUser. With
        // the default hook, keyGenerator always saw currentUser as undefined and
        // silently fell back to req.ip for every request — the limit was per-IP,
        // not per-user. Setting hook: 'preHandler' appends the limiter's check to
        // the route's preHandler array, after app.authenticate runs.
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req: { currentUser?: { id: string }; ip: string }) =>
            req.currentUser?.id ?? req.ip,
        },
      },
    },
    postMessage
  );
}
