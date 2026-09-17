// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, capResultItems, isMapCommand } from '@webatlas/shared';
import { AppError } from '../../../../errors';
import type { ToolFactory } from '../types';
import { inVietnam } from '../../../../lib/geo';
import { withAnalysisTimeout } from '../../../analysis/db';
import { getAnalysisPool } from '../../../analysis/pool';
import { nearestGeometries, queryNearest, type NearestRow } from '../../../analysis/ops/nearest';
import { LAYER_LABELS, activeVersionLabel } from './helpers';

// Query lives in modules/analysis/ops/nearest.ts, shared with the toolbar.

export const nearestFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'nearest_features',
    description:
      'Find the features of one layer closest to a point, with distances in kilometres. Use for "nearest", "closest to", "around". The point must come from locate_place or another tool result, never from memory — a wrong point returns a confident, wrong ranking.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      lon: z.number().describe('Longitude in WGS84 degrees, from locate_place or another tool result'),
      lat: z.number().describe('Latitude in WGS84 degrees, from locate_place or another tool result'),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ trong lãnh thổ Việt Nam do công cụ dữ liệu trả về.';
      }
      let rows: NearestRow[];
      let datasetVersion: string | null;
      try {
        // Bounded like the four analysis tools (see analysisTool.ts): this is
        // the same ORDER BY ST_Distance(geography) fallback query over a whole
        // _active view (ops/nearest.ts) that the toolbar's analysis ops guard
        // with a statement timeout on a small, dedicated pool — nothing here
        // makes it safe to run unbounded just because it's reached from a tool.
        [rows, datasetVersion] = await Promise.all([
          withAnalysisTimeout(getAnalysisPool(), (db) =>
            queryNearest(db, { layerKey: input.layerKey, lon: input.lon, lat: input.lat, limit: input.limit })
          ),
          activeVersionLabel(ctx.pool, input.layerKey),
        ]);
      } catch (e) {
        if (e instanceof AppError && (e.code === 'ANALYSIS_TIMEOUT' || e.code === 'ANALYSIS_BUSY')) {
          ctx.provenance({ tool: 'nearest_features', layerKey: input.layerKey, rowCount: 0, datasetVersion: null });
          return `Không thực hiện được: ${e.message}`;
        }
        throw e;
      }

      ctx.provenance({
        tool: 'nearest_features',
        layerKey: input.layerKey,
        rowCount: rows.length,
        datasetVersion,
      });

      if (rows.length === 0) {
        return `Không có dữ liệu: lớp ${LAYER_LABELS[input.layerKey]} chưa có đối tượng nào.`;
      }

      const connectors = { kind: 'showGeometries' as const, fit: true,
        items: capResultItems(nearestGeometries(input.layerKey, input.lon, input.lat, rows)).items };
      if (isMapCommand(connectors)) ctx.collect(connectors);

      return JSON.stringify({ layerKey: input.layerKey, from: [input.lon, input.lat], rows });
    },
  });
