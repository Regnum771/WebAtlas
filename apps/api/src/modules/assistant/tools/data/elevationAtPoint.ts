// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ToolFactory } from '../types';
import { inVietnam } from '../../../../lib/geo';
import { elevationAt, DEM_SOURCE } from '../../../elevation/repository';

export const elevationAtPointTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'elevation_at_point',
    description:
      'Ground elevation above sea level, in metres, at one coordinate. Bare-earth model: tree canopy and buildings are excluded, so this is the ground, not the treetops. The coordinate must come from locate_place or another tool result, never from memory.',
    inputSchema: z.object({
      lon: z.number().describe('Longitude in WGS84 degrees, from a tool result'),
      lat: z.number().describe('Latitude in WGS84 degrees, from a tool result'),
    }),
    run: async (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ trong lãnh thổ Việt Nam do công cụ dữ liệu trả về.';
      }

      // The query itself lives in modules/elevation/repository.ts, shared with
      // GET /api/elevation. What stays here is the part that is the tool's own: the
      // Vietnamese wording, and the provenance record.
      const result = await elevationAt(ctx.pool, input.lon, input.lat);

      ctx.provenance({
        tool: 'elevation_at_point',
        layerKey: null,
        rowCount: result.status === 'ok' ? 1 : 0,
        datasetVersion: result.status === 'ok' ? DEM_SOURCE : null,
      });

      if (result.status === 'unavailable') {
        return 'Không có dữ liệu: hệ thống này chưa nạp dữ liệu độ cao.';
      }
      if (result.status === 'nodata') {
        // Deliberately does not explain WHY there is no value here. Whether the point
        // is outside the covered provinces or on a nodata pixel is a server-side detail,
        // and inviting the model to explain it to an end user produces speculation.
        return 'Không có dữ liệu: không có số liệu độ cao cho vị trí này.';
      }
      return JSON.stringify({
        lon: input.lon,
        lat: input.lat,
        elevationM: result.elevationM,
        source: DEM_SOURCE,
      });
    },
  });
