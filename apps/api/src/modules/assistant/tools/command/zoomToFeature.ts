// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, isMapCommand, type HighlightPoint } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from '../../../../lib/geo';

export const zoomToFeatureTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zoom_to_feature',
    description:
      'Move the map to and highlight a single feature. Use the coordinates returned by a data tool; never invent them.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS).describe('Layer the feature belongs to'),
      featureId: z.string().describe('Feature id as returned by a data tool'),
      lon: z.number().describe('Longitude in WGS84 degrees, from a data tool result'),
      lat: z.number().describe('Latitude in WGS84 degrees, from a data tool result'),
    }),
    run: (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ do công cụ dữ liệu trả về.';
      }
      const command = {
        kind: 'zoomToFeature' as const,
        layerKey: input.layerKey,
        featureId: input.featureId,
        lonLat: [input.lon, input.lat] as [number, number],
      };
      if (!isMapCommand(command)) return 'Không phóng to được tới đối tượng này.';
      ctx.collect(command);
      const highlight: HighlightPoint = { lonLat: [input.lon, input.lat] };
      const highlightCommand = { kind: 'highlightFeatures' as const, points: [highlight] };
      if (!isMapCommand(highlightCommand)) return 'Đã phóng to tới đối tượng nhưng không đánh dấu được.';
      ctx.collect(highlightCommand);
      return 'Đã phóng to và đánh dấu đối tượng.';
    },
  });
