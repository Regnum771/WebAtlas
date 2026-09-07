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
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: { currentUser?: { id: string }; ip: string }) =>
            req.currentUser?.id ?? req.ip,
        },
      },
    },
    postMessage
  );
}
