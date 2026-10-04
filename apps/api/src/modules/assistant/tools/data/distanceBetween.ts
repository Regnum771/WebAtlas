// See zoomToRegion.ts: 'zod/v4' is required because of betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { activeVersionLabel, isFeatureId, layerView } from './helpers';

export const distanceBetweenTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'distance_between',
    description:
      'Measure the distance in kilometres between two features. Feature ids must come from a data tool result.',
    inputSchema: z.object({
      fromLayerKey: z.enum(EDITABLE_LAYER_KEYS),
      fromFeatureId: z.string(),
      toLayerKey: z.enum(EDITABLE_LAYER_KEYS),
      toFeatureId: z.string(),
    }),
    run: async (input) => {
      if (!isFeatureId(input.fromFeatureId) || !isFeatureId(input.toFeatureId)) {
        return 'Không có dữ liệu: mã đối tượng không hợp lệ.';
      }

      const [{ rows }, datasetVersion] = await Promise.all([
        ctx.pool.query(
          `SELECT a.name AS "fromName", b.name AS "toName",
                  round((ST_Distance(a.geom::geography, b.geom::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
             FROM ${layerView(input.fromLayerKey)} a, ${layerView(input.toLayerKey)} b
            WHERE a.id = $1 AND b.id = $2`,
          [input.fromFeatureId, input.toFeatureId]
        ),
        activeVersionLabel(ctx.pool, input.fromLayerKey),
      ]);

      ctx.provenance({
        tool: 'distance_between',
        layerKey: input.fromLayerKey,
        rowCount: rows.length,
        datasetVersion,
      });

      if (rows.length === 0) {
        return 'Không có dữ liệu: không tìm thấy một trong hai đối tượng.';
      }
      return JSON.stringify(rows[0]);
    },
  });
