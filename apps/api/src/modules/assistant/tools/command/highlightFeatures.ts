// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  EDITABLE_LAYER_KEYS,
  MAX_HIGHLIGHT_POINTS,
  capResultItems,
  isMapCommand,
  type HighlightPoint,
  type ResultGeometry,
} from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from '../../../../lib/geo';
import { resolveFeature } from '../data/helpers';

export const highlightFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'highlight_features',
    description:
      'Mark features on the map so the user can see which ones an answer refers to. Prefer featureRefs (layerKey + featureId from a data tool): rivers, lakes and zones are then drawn as their whole shape and the map frames them. Use points only for bare coordinates returned by a data tool.',
    inputSchema: z
      .object({
        points: z
          .array(
            z.object({
              lon: z.number(),
              lat: z.number(),
              label: z.string().optional().describe('Short Vietnamese label, e.g. the feature name'),
            })
          )
          .min(1)
          .max(MAX_HIGHLIGHT_POINTS)
          .optional(),
        featureRefs: z
          .array(z.object({ layerKey: z.enum(EDITABLE_LAYER_KEYS), featureId: z.string() }))
          .min(1)
          .max(MAX_HIGHLIGHT_POINTS)
          .optional(),
      })
      .refine((v) => v.points !== undefined || v.featureRefs !== undefined, {
        message: 'Cần points hoặc featureRefs',
      }),
    run: async (input) => {
      const parts: string[] = [];

      if (input.featureRefs) {
        const refs = input.featureRefs;
        const resolved = await Promise.all(refs.map((r) => resolveFeature(ctx.pool, r.layerKey, r.featureId)));
        const items: ResultGeometry[] = [];
        resolved.forEach((f, i) => {
          if (!f) return;
          items.push({
            geometry: f.geometry,
            role: 'highlight',
            ...(f.name ? { label: f.name } : {}),
            layerKey: refs[i].layerKey,
            featureId: f.featureId,
          });
        });
        const capped = capResultItems(items);
        const command = { kind: 'showGeometries' as const, items: capped.items, fit: true };
        if (capped.items.length > 0 && isMapCommand(command)) {
          ctx.collect(command);
          parts.push(`Đã tô sáng ${capped.items.length} đối tượng trên bản đồ.`);
        }
        const missing = resolved.filter((f) => f === null).length;
        if (missing > 0) parts.push(`Không có dữ liệu: không tìm thấy ${missing} đối tượng.`);
      }

      if (input.points) {
        const points: HighlightPoint[] = input.points
          .filter((p) => inVietnam(p.lon, p.lat))
          .map((p) => ({ lonLat: [p.lon, p.lat] as [number, number], ...(p.label ? { label: p.label } : {}) }));
        const command = { kind: 'highlightFeatures' as const, points };
        if (points.length > 0 && isMapCommand(command)) {
          ctx.collect(command);
          parts.push(`Đã đánh dấu ${points.length} vị trí trên bản đồ.`);
        } else {
          parts.push('Không có toạ độ hợp lệ để đánh dấu — chỉ dùng toạ độ do công cụ dữ liệu trả về.');
        }
      }

      return parts.join(' ');
    },
  });
