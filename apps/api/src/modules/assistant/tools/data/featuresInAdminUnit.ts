// See zoomToRegion.ts: 'zod/v4' is required because of betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, REGION_PROVINCE_CODES, REGION_PROVINCE_NAMES } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, entityPredicate, layerView } from './helpers';

/**
 * A relational query, not a geometric one: the administrative codes are stamped on every
 * feature in advance (packages/versioning, adminStamp.ts), and the view's partial GIN indexes
 * on province_codes / ward_codes serve the array test directly.
 */
export const featuresInAdminUnitTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'features_in_admin_unit',
    description:
      'Count and list the features of one layer inside an administrative unit (province or ward), by its official code. Use for "ở tỉnh X", "trong xã Y". The code comes from the user or from another tool, never invented.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      code: z
        .string()
        .regex(/^\d{1,8}$/, 'Mã đơn vị hành chính gồm 1-8 chữ số')
        .describe(
          `Administrative code. For a province, one of: ${REGION_PROVINCE_CODES.map(
            (c) => `${c} (${REGION_PROVINCE_NAMES[c]})`
          ).join(', ')}. For a ward, there is no gazetteer here — the code must come from the user's message or from another tool's result, never invented.`
        ),
    }),
    run: async (input) => {
      const [{ rows: unitRows }, datasetVersion] = await Promise.all([
        ctx.pool.query<{ name: string; level: string }>(
          `SELECT name, 'tỉnh' AS level FROM admin.provinces WHERE code = $1
           UNION ALL
           SELECT name, 'xã/phường' AS level FROM admin.wards WHERE code = $1`,
          [input.code]
        ),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);

      if (unitRows.length === 0) {
        ctx.provenance({ tool: 'features_in_admin_unit', layerKey: input.layerKey, rowCount: 0, datasetVersion });
        return `Không có dữ liệu: không có đơn vị hành chính nào mang mã ${input.code}.`;
      }

      const unit = `${unitRows[0].level} ${unitRows[0].name}`;
      // 'province_codes' or 'ward_codes' only — chosen from the DB lookup above, never
      // from raw tool input, so this interpolation is safe the same way layerView's is.
      const column = unitRows[0].level === 'tỉnh' ? 'province_codes' : 'ward_codes';
      const { rows } = await ctx.pool.query<{ featureId: string; name: string | null; lon: number; lat: number; total: string }>(
        `SELECT id::text AS "featureId", name, ${POINT_SQL}, count(*) OVER () AS total
           FROM ${layerView(input.layerKey)}
          WHERE ${column} && ARRAY[$1] AND ${entityPredicate(input.layerKey)}
          ORDER BY name NULLS LAST
          LIMIT $2`,
        [input.code, ROW_LIMIT]
      );

      const count = rows.length > 0 ? Number(rows[0].total) : 0;
      ctx.provenance({ tool: 'features_in_admin_unit', layerKey: input.layerKey, rowCount: count, datasetVersion });

      if (count === 0) {
        return `Không có dữ liệu: ${unit} không có đối tượng nào thuộc lớp ${LAYER_LABELS[input.layerKey]}.`;
      }
      return JSON.stringify({
        layerKey: input.layerKey,
        unit,
        count,
        rows: rows.map((r) => ({ featureId: r.featureId, name: r.name, lon: r.lon, lat: r.lat })),
      });
    },
  });
