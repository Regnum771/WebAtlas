// See zoomToRegion.ts: 'zod/v4' is required because of betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, entityPredicate, layerView } from './helpers';

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
      const envelope = 'ST_MakeEnvelope($1, $2, $3, $4, 4326)';
      // count(*) OVER() rides along with the capped list in one scan of that
      // filtered set instead of a separate query scanning it twice.
      const [{ rows }, datasetVersion] = await Promise.all([
        ctx.pool.query<{ featureId: string; name: string | null; lon: number; lat: number; totalCount: string }>(
          `SELECT id::text AS "featureId", name, ${POINT_SQL}, count(*) OVER()::text AS "totalCount"
             FROM ${layerView(input.layerKey)}
            WHERE geom && ${envelope} AND ${entityPredicate(input.layerKey)}
            ORDER BY name NULLS LAST
            LIMIT ${ROW_LIMIT}`,
          bbox
        ),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);
      const count = rows.length > 0 ? Number(rows[0].totalCount) : 0;
      const listed = rows.map(({ featureId, name, lon, lat }) => ({ featureId, name, lon, lat }));

      ctx.provenance({
        tool: 'features_in_view',
        layerKey: input.layerKey,
        rowCount: count,
        datasetVersion,
      });

      // The spec's one guard on top of soft grounding: a tool that exists for
      // the question and finds nothing must say so, so the model reports "no
      // data" instead of filling the silence from its own knowledge.
      if (count === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.layerKey]} nào trong khu vực này.`;
      }
      return JSON.stringify({ layerKey: input.layerKey, bbox, count, listed: listed.length, rows: listed });
    },
  });
