import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BASEMAP_TYPES, EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { AppError, AuthError } from '../../errors';
import { config } from '../../config/env';
import { runAssistant, budget } from './service';

const MapContextSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  zoom: z.number().min(0).max(24),
  visibleLayerStateIds: z.array(z.string()).max(32),
  basemap: z.enum(BASEMAP_TYPES),
  selectedFeature: z
    .object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string().max(128),
      name: z.string().max(256).optional(),
    })
    .optional(),
});

const MessageBody = z.object({
  sessionId: z.string().min(1).max(128),
  // 2000 chars is far more than any real question and keeps a pathological
  // paste from becoming an expensive prompt.
  message: z.string().trim().min(1, 'Câu hỏi không được để trống').max(2000),
  mapContext: MapContextSchema,
});

export async function postMessage(req: FastifyRequest, reply: FastifyReply) {
  if (!req.currentUser) throw new AuthError();
  const { sessionId, message, mapContext } = validate(MessageBody, req.body);

  if (!config.ANTHROPIC_API_KEY) {
    throw new AppError(
      503,
      'ASSISTANT_UNAVAILABLE',
      'Trợ lý chưa được cấu hình trên máy chủ này.'
    );
  }

  const status = budget.check(req.currentUser.id);
  if (!status.allowed) {
    throw new AppError(
      429,
      'ASSISTANT_BUDGET_EXCEEDED',
      'Bạn đã dùng hết hạn mức trợ lý trong ngày. Vui lòng thử lại sau 00:00 UTC.',
      { used: status.used, limit: status.limit }
    );
  }

  const result = await runAssistant({
    pool: req.server.pg,
    userId: req.currentUser.id,
    sessionId,
    message,
    mapContext,
  });
  reply.send(result);
}
