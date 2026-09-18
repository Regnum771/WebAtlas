// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { bufferOp } from '../../../analysis/ops/buffer';
import { runAnalysisTool } from './analysisTool';

export const bufferFeatureTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'buffer_feature',
    description:
      'Draw a buffer zone (vùng đệm / hành lang) of radiusKm around one feature on the map and report its area. featureId must come from a data tool.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      radiusKm: z.number().gt(0).max(100),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'buffer_feature', input.layerKey, (db) =>
        bufferOp(db, { feature: { layerKey: input.layerKey, featureId: input.featureId }, radiusKm: input.radiusKm })
      ),
  });
