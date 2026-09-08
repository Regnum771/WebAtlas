// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { BASEMAP_TYPES, isMapCommand } from '@webatlas/shared';
import type { BasemapName } from '@webatlas/shared';
import type { ToolFactory } from '../types';

const LABELS: Record<BasemapName, string> = {
  street: 'bản đồ đường phố',
  satellite: 'ảnh vệ tinh',
  dem: 'mô hình số độ cao',
};

export const setBasemapTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'set_basemap',
    description: 'Change the background map: street, satellite, or elevation (dem).',
    inputSchema: z.object({ basemap: z.enum(BASEMAP_TYPES) }),
    run: (input) => {
      const command = { kind: 'setBasemap' as const, basemap: input.basemap };
      if (!isMapCommand(command)) return 'Nền bản đồ không hợp lệ.';
      ctx.collect(command);
      return `Đã đổi nền sang ${LABELS[input.basemap]}.`;
    },
  });
