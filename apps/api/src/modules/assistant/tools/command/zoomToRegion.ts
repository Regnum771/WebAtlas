// Dùng 'zod/v4', không phải 'zod': betaZodTool gọi toJSONSchema() của zod/v4/core,
// hàm này đọc nội bộ schema theo định dạng v4 (.def). Schema v3 cổ điển ném TypeError
// ngay khi dựng công cụ. zod@3.25 có sẵn cả hai nhánh.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { REGION_PROVINCE_CODES, REGION_PROVINCE_NAMES, isMapCommand } from '@webatlas/shared';
import type { ToolFactory } from '../types';

export const zoomToRegionTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'zoom_to_province',
    description:
      'Move the map to one of the six provinces in the working region. Use when the user names a province.',
    inputSchema: z.object({
      provinceCode: z
        .string()
        .describe(
          `Province code. One of: ${REGION_PROVINCE_CODES.map(
            (c) => `${c} (${REGION_PROVINCE_NAMES[c]})`
          ).join(', ')}`
        ),
    }),
    run: (input) => {
      const command = { kind: 'zoomToRegion' as const, provinceCode: input.provinceCode };
      // The model picks the argument, so the shared validator is the only thing
      // between a hallucinated province code and the map.
      if (!isMapCommand(command)) {
        return `Mã tỉnh ${input.provinceCode} không thuộc vùng công tác. Các tỉnh hợp lệ: ${REGION_PROVINCE_CODES.map(
          (c) => REGION_PROVINCE_NAMES[c]
        ).join(', ')}.`;
      }
      ctx.collect(command);
      return `Đã phóng to tới ${REGION_PROVINCE_NAMES[input.provinceCode]}.`;
    },
  });
