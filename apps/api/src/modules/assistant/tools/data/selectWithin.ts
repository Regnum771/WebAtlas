// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { selectWithinOp } from '../../../analysis/ops/selectWithin';
import { runAnalysisTool } from './analysisTool';

export const selectWithinTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'select_within',
    description:
      'Count and highlight features of one or more layers inside an area. The area is a polygon feature (lake, flood zone) used as-is, or any feature buffered by radiusKm (e.g. dams within 10 km of a river). A point or line feature needs radiusKm. Use for "trong phạm vi", "nằm trong", "dọc theo sông".',
    inputSchema: z.object({
      layerKeys: z.array(z.enum(EDITABLE_LAYER_KEYS)).min(1).max(EDITABLE_LAYER_KEYS.length),
      area: z.object({
        layerKey: z.enum(EDITABLE_LAYER_KEYS),
        featureId: z.string(),
        radiusKm: z.number().gt(0).max(100).optional(),
      }),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'select_within', input.layerKeys.length === 1 ? input.layerKeys[0] : null, (db) =>
        selectWithinOp(db, {
          feature: { layerKey: input.area.layerKey, featureId: input.area.featureId },
          ...(input.area.radiusKm !== undefined ? { bufferKm: input.area.radiusKm } : {}),
          layerKeys: input.layerKeys,
        })
      ),
  });
