// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { zonalElevationOp } from '../../../analysis/ops/zonalElevation';
import type { ZonalInput } from '../../../analysis/schemas';
import { runAnalysisTool } from './analysisTool';

export const zonalElevationTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zonal_elevation',
    description:
      'Lowest, highest and mean ground elevation inside an area: a polygon feature, or any feature buffered by radiusKm (a point or line needs radiusKm). Max 5,000 km².',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      radiusKm: z.number().gt(0).max(100).optional(),
    }),
    run: (input) =>
      runAnalysisTool(ctx, 'zonal_elevation', input.layerKey, (db) =>
        // areaGeometry reads bufferKm; ZonalInput's HTTP schema simply does not offer it.
        zonalElevationOp(db, {
          feature: { layerKey: input.layerKey, featureId: input.featureId },
          ...(input.radiusKm !== undefined ? { bufferKm: input.radiusKm } : {}),
        } as ZonalInput)
      ),
  });
