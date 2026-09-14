// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { LAYER_STATE_IDS, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

export const setLayerVisibleTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'set_layer_visible',
    description: 'Turn a map layer on or off.',
    inputSchema: z.object({
      layerStateId: z.string().describe(`Layer id. One of: ${LAYER_STATE_IDS.join(', ')}`),
      visible: z.boolean(),
    }),
    run: (input) => {
      const command = {
        kind: 'setLayerVisible' as const,
        layerStateId: input.layerStateId,
        visible: input.visible,
      };
      if (!isMapCommand(command)) {
        return `Không có lớp dữ liệu nào tên "${input.layerStateId}". Các lớp hợp lệ: ${LAYER_STATE_IDS.join(', ')}.`;
      }
      ctx.collect(command);
      return input.visible ? 'Đã bật lớp dữ liệu.' : 'Đã tắt lớp dữ liệu.';
    },
  });
