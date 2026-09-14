// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { MAX_HIGHLIGHT_POINTS, isMapCommand, type HighlightPoint } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from './zoomToFeature';

export const highlightFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'highlight_features',
    description:
      'Mark locations on the map. Use the coordinates returned by a data tool so the user can see which features an answer refers to.',
    inputSchema: z.object({
      points: z
        .array(
          z.object({
            lon: z.number(),
            lat: z.number(),
            label: z.string().optional().describe('Short Vietnamese label, e.g. the feature name'),
          })
        )
        .min(1)
        .max(MAX_HIGHLIGHT_POINTS),
    }),
    run: (input) => {
      const points: HighlightPoint[] = input.points
        .filter((p) => inVietnam(p.lon, p.lat))
        .map((p) => ({
          lonLat: [p.lon, p.lat] as [number, number],
          ...(p.label ? { label: p.label } : {}),
        }));
      if (points.length === 0) {
        return 'Không có toạ độ hợp lệ để đánh dấu — chỉ dùng toạ độ do công cụ dữ liệu trả về.';
      }
      const command = { kind: 'highlightFeatures' as const, points };
      if (!isMapCommand(command)) return 'Không đánh dấu được các vị trí này.';
      ctx.collect(command);
      return `Đã đánh dấu ${points.length} vị trí trên bản đồ.`;
    },
  });
