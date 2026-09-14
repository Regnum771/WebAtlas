// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, LAYER_GEOMETRY, type EditableLayerKey } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, activeVersionLabel, candidateCtes, isFeatureId, layerTable } from './helpers';

/** Read from the shared geometry registry rather than listed a second time
 *  here — a hand-copied list is exactly what drifts when a layer changes type. */
function hasArea(key: EditableLayerKey): boolean {
  return LAYER_GEOMETRY[key].includes('Polygon');
}

export const areaOfTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'area_of',
    description:
      'Measure the area of one polygon feature in square kilometres. Only for polygon layers: lakes, flood_zones, flood_generation.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
    }),
    run: async (input) => {
      if (!hasArea(input.layerKey)) {
        return `Lớp ${LAYER_LABELS[input.layerKey]} không có diện tích — đây là lớp điểm hoặc đường.`;
      }
      if (!isFeatureId(input.featureId)) return 'Không có dữ liệu: mã đối tượng không hợp lệ.';

      // Candidate predicate is `id = $1` on the base table — a primary-key
      // hit, instant. Re-applying it below (plus NOT deleted) after
      // resolution is mandatory: if this id belonged to a superseded
      // version, resolution returns the active row for that external_id,
      // whose id differs, so the re-applied filter correctly yields nothing.
      const ctes = candidateCtes(
        input.layerKey,
        `SELECT external_id FROM ${layerTable(input.layerKey)} WHERE id = $1`
      );

      const [{ rows }, datasetVersion] = await Promise.all([
        ctx.pool.query(
          `WITH RECURSIVE ${ctes}
           SELECT name,
                  round((ST_Area(geom::geography) / 1000000)::numeric, 3)::float8 AS "areaKm2",
                  round((ST_Perimeter(geom::geography) / 1000)::numeric, 2)::float8 AS "perimeterKm"
             FROM resolved
            WHERE id = $1 AND NOT deleted`,
          [input.featureId]
        ),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);

      ctx.provenance({
        tool: 'area_of',
        layerKey: input.layerKey,
        rowCount: rows.length,
        datasetVersion,
      });

      if (rows.length === 0) return 'Không có dữ liệu: không tìm thấy đối tượng.';
      return JSON.stringify({ layerKey: input.layerKey, ...rows[0] });
    },
  });
