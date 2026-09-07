// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, layerView } from './helpers';

export const featuresInViewTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'features_in_view',
    description:
      'Count and list the features of one layer inside a map area. Defaults to what the user is currently looking at. Use this for "here", "in this area", "on screen".',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      bbox: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional()
        .describe('[west, south, east, north] in WGS84 degrees. Omit to use the current viewport.'),
    }),
    run: async (input) => {
      const bbox = input.bbox ?? ctx.mapContext.bbox;
      const view = layerView(input.layerKey);
      const envelope = 'ST_MakeEnvelope($1, $2, $3, $4, 4326)';

      const { rows: countRows } = await ctx.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${view} WHERE geom && ${envelope}`,
        bbox
      );
      const count = Number(countRows[0].n);

      const { rows } = await ctx.pool.query(
        `SELECT id::text AS "featureId", name, ${POINT_SQL}
           FROM ${view}
          WHERE geom && ${envelope}
          ORDER BY name NULLS LAST
          LIMIT ${ROW_LIMIT}`,
        bbox
      );

      ctx.provenance({
        tool: 'features_in_view',
        layerKey: input.layerKey,
        rowCount: count,
        datasetVersion: await activeVersionLabel(ctx.pool, input.layerKey),
      });

      // The spec's one guard on top of soft grounding: a tool that exists for
      // the question and finds nothing must say so, so the model reports "no
      // data" instead of filling the silence from its own knowledge.
      if (count === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.layerKey]} nào trong khu vực này.`;
      }
      return JSON.stringify({ layerKey: input.layerKey, bbox, count, listed: rows.length, rows });
    },
  });
