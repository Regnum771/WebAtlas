// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { elevationProfileOp } from '../../../analysis/ops/elevationProfile';
import { runAnalysisTool } from './analysisTool';

export const elevationProfileTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'elevation_profile',
    description:
      'Elevation profile along a line feature (usually a river): length, lowest/highest point, total rise and fall, mean gradient. Bare-earth DEM (FABDEM). featureId must come from a data tool.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      samples: z.number().int().min(2).max(200).default(100),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'elevation_profile', input.layerKey, (db) =>
        elevationProfileOp(db, { feature: { layerKey: input.layerKey, featureId: input.featureId }, samples: input.samples })
      ),
  });
