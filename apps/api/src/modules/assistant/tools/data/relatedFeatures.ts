// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, candidateCtes, isFeatureId, layerTable } from './helpers';

/** A radius beyond this stops being a relationship and becomes a full scan of
 *  the layer — rivers alone is ~9,500 rows. */
const MAX_RADIUS_KM = 200;

/**
 * Conservative km-per-degree used only to size the candidate step's degree
 * radius from radiusKm. `ST_DWithin(geometry, geometry, dist)` treats `dist`
 * in degrees (SRID 4326), not metres — but unlike casting to `::geography`
 * (confirmed with EXPLAIN ANALYZE: forces a sequential scan, since no index
 * exists on that expression), the plain-geometry form is servable by the
 * base table's GiST index. 1° latitude is a near-constant ~111.32 km, but 1°
 * longitude shrinks by cos(latitude); at Vietnam's northernmost extent
 * (~23.5°N) that's ~102 km/°. Dividing by 100 stays under that everywhere in
 * Vietnam, so the degree-circle can only be a superset of the true metre
 * radius, never miss a real candidate. The exact metric ST_DWithin(geography)
 * below re-applies the true radius on the much smaller resolved set.
 */
const CONSERVATIVE_KM_PER_DEGREE = 100;

export const relatedFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'related_features',
    description:
      'Find features of one layer within a radius of a feature of another layer, e.g. rivers within 20 km of a dam, or monitoring stations near a flood zone.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS).describe('Layer of the anchor feature'),
      featureId: z.string().describe('Anchor feature id, from a data tool result'),
      relatedLayerKey: z.enum(EDITABLE_LAYER_KEYS).describe('Layer to search'),
      radiusKm: z.number().min(0.1).max(MAX_RADIUS_KM).default(20),
    }),
    run: async (input) => {
      if (input.radiusKm > MAX_RADIUS_KM) {
        return `Bán kính tối đa là ${MAX_RADIUS_KM} km.`;
      }
      if (!isFeatureId(input.featureId)) return 'Không có dữ liệu: mã đối tượng không hợp lệ.';

      // Step 1: resolve the anchor's geometry. Candidate predicate is
      // `id = $1` on the base table — a primary-key hit. The related layer's
      // candidate predicate (step 2) needs this geometry as a bind
      // parameter, so it cannot be folded into one query with step 2.
      const anchorCtes = candidateCtes(
        input.layerKey,
        `SELECT external_id FROM ${layerTable(input.layerKey)} WHERE id = $1`,
        'anchor_'
      );
      const [anchorResult, datasetVersion] = await Promise.all([
        ctx.pool.query<{ name: string | null; geomWkt: string }>(
          `WITH RECURSIVE ${anchorCtes}
           SELECT name, ST_AsText(geom) AS "geomWkt"
             FROM anchor_resolved
            WHERE id = $1 AND NOT deleted`,
          [input.featureId]
        ),
        activeVersionLabel(ctx.pool, input.relatedLayerKey),
      ]);

      if (anchorResult.rows.length === 0) {
        ctx.provenance({
          tool: 'related_features',
          layerKey: input.relatedLayerKey,
          rowCount: 0,
          datasetVersion,
        });
        return 'Không có dữ liệu: không tìm thấy đối tượng gốc.';
      }
      const anchor = anchorResult.rows[0];
      const radiusM = input.radiusKm * 1000;
      const radiusDegrees = input.radiusKm / CONSERVATIVE_KM_PER_DEGREE;

      // Step 2: candidate predicate is ST_DWithin against the anchor's
      // geometry (bound as WKT, parsed back with ST_GeomFromText) in plain
      // geometry/degree space — see CONSERVATIVE_KM_PER_DEGREE above for why
      // this, rather than a geography cast, is what actually reaches the
      // related layer's GiST index. Re-applied below after resolution with
      // the true metric radius (plus NOT deleted), since the candidate step
      // ran across every dataset version and used only a padded approximation.
      const relatedCtes = candidateCtes(
        input.relatedLayerKey,
        `SELECT external_id FROM ${layerTable(input.relatedLayerKey)}
          WHERE ST_DWithin(geom, ST_GeomFromText($1, 4326), $2)`,
        'related_'
      );
      const distanceExpr = 'ST_Distance(geom::geography, ST_GeomFromText($1, 4326)::geography)';
      const { rows } = await ctx.pool.query(
        `WITH RECURSIVE ${relatedCtes}
         SELECT id::text AS "featureId", name, ${POINT_SQL},
                round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
           FROM related_resolved
          WHERE NOT deleted AND ST_DWithin(geom::geography, ST_GeomFromText($1, 4326)::geography, $3)
          ORDER BY ${distanceExpr}
          LIMIT ${ROW_LIMIT}`,
        [anchor.geomWkt, radiusDegrees, radiusM]
      );

      ctx.provenance({
        tool: 'related_features',
        layerKey: input.relatedLayerKey,
        rowCount: rows.length,
        datasetVersion,
      });

      if (rows.length === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.relatedLayerKey]} nào trong bán kính ${input.radiusKm} km.`;
      }
      return JSON.stringify({
        anchor: { layerKey: input.layerKey, name: anchor.name },
        relatedLayerKey: input.relatedLayerKey,
        radiusKm: input.radiusKm,
        rows,
      });
    },
  });
