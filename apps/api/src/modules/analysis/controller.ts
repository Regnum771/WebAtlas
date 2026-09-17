import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ANALYSIS_OPS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';
import { withAnalysisTimeout } from './db';
import { OPS } from './ops';

const OpParams = z.object({ op: z.enum(ANALYSIS_OPS) });

/** POST /api/analysis/:op — public like /api/search, bounded by caps, timeout and rate limit. */
export async function runAnalysis(req: FastifyRequest, reply: FastifyReply) {
  const { op } = validate(OpParams, req.params);
  const def = OPS[op];
  if (!def) throw new NotFoundError('Phép phân tích chưa được hỗ trợ');
  const input = validate(def.schema, req.body ?? {});
  const result = await withAnalysisTimeout(req.server.pg, (db) => def.run(db, input));
  reply.send(result);
}
