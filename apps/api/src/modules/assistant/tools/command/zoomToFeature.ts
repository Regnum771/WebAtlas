import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

/**
 * Rough Vietnam bounds. `isMapCommand` only checks that lonLat is two finite
 * numbers, so without this a (0, 0) from a null-island row would fly the map
 * into the Atlantic and report success.
 */
export function inVietnam(lon: number, lat: number): boolean {
  return lon >= 102 && lon <= 110 && lat >= 8 && lat <= 24;
}

export const zoomToFeatureTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zoom_to_feature',
    description:
      'Move the map to a single feature. Use the coordinates returned by a data tool; never invent them.',
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
      return 'Đã phóng to tới đối tượng.';
    },
  });
