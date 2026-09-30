import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Roi } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { withAnalysisTimeout } from '../analysis/db';
import { getAnalysisPool } from '../analysis/pool';
import { resolveRoi } from './resolve';
import { RoiSchema } from './schema';

const ResolveBody = z.object({ roi: RoiSchema });

/**
 * POST /api/roi/resolve — public like /api/analysis/:op, and bounded the same way: the
 * analysis pool, a read-only transaction, the 5 s statement timeout (NFR-3). Returns only
 * the ResolvedRoi; the full-precision geometry and the source facts stay server-side.
 */
export async function resolveRoiRoute(req: FastifyRequest, reply: FastifyReply) {
  const { roi } = validate(ResolveBody, req.body ?? {});
  const { resolved } = await withAnalysisTimeout(getAnalysisPool(), (db) => resolveRoi(db, roi as Roi));
  reply.send(resolved);
}
