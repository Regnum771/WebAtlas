// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { inVietnam } from '../command/zoomToFeature';
import { LAYER_LABELS, POINT_SQL, activeVersionLabel, candidateCtes, layerTable, layerView } from './helpers';

// How many nearest-by-planar-distance candidates to pull off the base table
// per requested result, before resolving the version chain and re-ordering
// by true geography distance. KNN has no simple indexable predicate the way
// a bbox test does, so this is a bounded over-fetch rather than an exact
// filter — generous enough that in practice (one active ingest version per
// layer) the resolved set always has at least `limit` rows, but a layer with
// many edit-versions could starve the candidate set, hence the fallback
// below rather than trusting the over-fetch blindly.
const NEAREST_OVERFETCH_FACTOR = 20;

export const nearestFeaturesTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'nearest_features',
    description:
      'Find the features of one layer closest to a point, with distances in kilometres. Use for "nearest", "closest to", "around".',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      lon: z.number().describe('Longitude in WGS84 degrees'),
      lat: z.number().describe('Latitude in WGS84 degrees'),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async (input) => {
      if (!inVietnam(input.lon, input.lat)) {
        return 'Toạ độ không hợp lệ — chỉ dùng toạ độ trong lãnh thổ Việt Nam do công cụ dữ liệu trả về.';
      }
      const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
      const overfetch = input.limit * NEAREST_OVERFETCH_FACTOR;
      // Candidate step: nearest-by-planar-distance off the base table can use
      // rivers_geom_index (and its equivalent on every other layer) to serve
      // the ORDER BY ... LIMIT directly. See candidateCtes' doc comment for
      // why the same ORDER BY against the _active view cannot.
      const ctes = candidateCtes(
        input.layerKey,
        `SELECT external_id FROM ${layerTable(input.layerKey)} ORDER BY geom <-> ${point} LIMIT $4`
      );
      // Distance on the spheroid (::geography), not in degrees: a degree of
      // longitude is ~109 km at the equator and the answer is quoted in km.
      // The base-table candidate step above orders by planar distance only to
      // reach the index — this final ORDER BY (over the much smaller resolved
      // set) uses the true geography distance, the same expression reported
      // as distanceKm, so the order and the number can never disagree.
      const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
      const fastSql = `WITH RECURSIVE ${ctes}
        SELECT id::text AS "featureId", name, ${POINT_SQL},
               round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
          FROM resolved
         WHERE NOT deleted
         ORDER BY ${distanceExpr}
         LIMIT $3`;

      const [{ rows: fastRows }, datasetVersion] = await Promise.all([
        ctx.pool.query(fastSql, [input.lon, input.lat, input.limit, overfetch]),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);

      let rows = fastRows;
      if (rows.length < input.limit) {
        // The over-fetch came back short. That's a legitimate answer if the
        // layer genuinely has fewer than `limit` active features — but if it
        // has enough, the candidate step must have missed some (starved by
        // many edit-versions spreading the same external_ids across more
        // physical rows than the over-fetch pulled). Rather than silently
        // return a short answer, fall back to the exact query.
        const view = layerView(input.layerKey);
        const { rows: countRows } = await ctx.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${view}`
        );
        if (Number(countRows[0].n) >= input.limit) {
          const { rows: exactRows } = await ctx.pool.query(
            `SELECT id::text AS "featureId", name, ${POINT_SQL},
                    round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
               FROM ${view}
              ORDER BY ${distanceExpr}
              LIMIT $3`,
            [input.lon, input.lat, input.limit]
          );
          rows = exactRows;
        }
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
      return JSON.stringify({ layerKey: input.layerKey, from: [input.lon, input.lat], rows });
    },
  });
