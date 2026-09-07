// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from '../command/zoomToFeature';
import { LAYER_LABELS, POINT_SQL, activeVersionLabel, layerView } from './helpers';

export const nearestFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'nearest_features',
    description:
      'Find the features of one layer closest to a point, with distances in kilometres. Use for "nearest", "closest to", "around".',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      lon: z.number().describe('Longitude in WGS84 degrees'),
      lat: z.number().describe('Latitude in WGS84 degrees'),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ trong lãnh thổ Việt Nam do công cụ dữ liệu trả về.';
      }
      const view = layerView(input.layerKey);
      // Distance on the spheroid (::geography), not in degrees: a degree of
      // longitude is ~109 km at the equator and the answer is quoted in km.
      // The ORDER BY uses the same expression so the KNN order and the reported
      // distance can never disagree.
      const { rows } = await ctx.pool.query(
        `SELECT id::text AS "featureId", name, ${POINT_SQL},
                round((ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
           FROM ${view}
          ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          LIMIT $3`,
        [input.lon, input.lat, input.limit]
      );

      ctx.provenance({
        tool: 'nearest_features',
        layerKey: input.layerKey,
        rowCount: rows.length,
        datasetVersion: await activeVersionLabel(ctx.pool, input.layerKey),
      });

      if (rows.length === 0) {
        return `Không có dữ liệu: lớp ${LAYER_LABELS[input.layerKey]} chưa có đối tượng nào.`;
      }
      return JSON.stringify({ layerKey: input.layerKey, from: [input.lon, input.lat], rows });
    },
  });
