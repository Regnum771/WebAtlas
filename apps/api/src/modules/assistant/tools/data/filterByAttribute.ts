// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, layerView } from './helpers';

/**
 * Which columns may be filtered, per layer. A column name cannot be a bind
 * parameter, so this allowlist is the boundary: anything not listed here never
 * reaches the query string. It deliberately excludes the audit columns
 * (created_by, updated_by, dataset_version_id) — those are plumbing, not
 * attributes anyone asks about, and they identify users.
 *
 * Equality/contains only. Numeric ranges ("dams above 50 MW") are the SQL
 * escape hatch's job; adding an operator vocabulary here would rebuild a query
 * language one keyword at a time.
 */
export const FILTERABLE_COLUMNS: Record<EditableLayerKey, string[]> = {
  dams: ['name', 'name_en', 'status', 'year_launched', 'year_operational'],
  rivers: ['name', 'code', 'stream_order'],
  lakes: ['name', 'lake_type'],
  stations: ['name', 'station_type', 'status', 'value'],
  flood_zones: ['name', 'hazard_type', 'risk_level', 'area'],
  drought_points: ['name', 'risk_level', 'status'],
  saltwater_intrusion: ['name', 'salinity', 'risk_level', 'status'],
  flood_generation: ['name', 'risk_level', 'area', 'flow_rate'],
};

export const filterByAttributeTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'filter_by_attribute',
    description:
      'List the features of one layer whose attribute contains a value, e.g. dams with status "Operating". Matching is case-insensitive and partial.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      column: z
        .string()
        .describe(
          `Attribute to filter on. Allowed per layer: ${Object.entries(FILTERABLE_COLUMNS)
            .map(([k, cols]) => `${k}: ${cols.join('/')}`)
            .join('; ')}`
        ),
      value: z.string().max(100),
    }),
    run: async (input) => {
      const allowed = FILTERABLE_COLUMNS[input.layerKey];
      if (!allowed.includes(input.column)) {
        return `Không lọc được theo "${input.column}" trên lớp ${LAYER_LABELS[input.layerKey]}. Các thuộc tính hợp lệ: ${allowed.join(', ')}.`;
      }

      // input.column is a member of the allowlist above, never raw model
      // text — the same rule layerView/layerTable enforce for layer keys.
      //
      // Deliberately NOT using candidateCtes here, unlike this file's three
      // siblings. That pattern only pays off when the candidate predicate is
      // index-servable (a GiST hit for geometry, a primary-key hit for
      // `id = $1`) so the candidate step is cheap and shrinks the set before
      // the expensive recursive resolve runs. Here the predicate is `ILIKE`
      // on an arbitrary text column, and none of FILTERABLE_COLUMNS is
      // trigram- or btree-indexed — so the "candidate" step would itself be
      // a full unindexed scan of the base table, and that table would then
      // be scanned a second time inside resolved's join, where querying the
      // view directly scans it once. Measured with EXPLAIN ANALYZE against
      // water.dams: the view form runs ~43ms regardless of match; the
      // candidate-then-resolve form ran 82-130ms for the same queries. If an
      // index is ever added on one of these columns, this call site is where
      // the candidate form would start earning its keep again — but adding
      // that index is a separate decision with its own migration and
      // write-path cost.
      const [{ rows: allRows }, datasetVersion] = await Promise.all([
        ctx.pool.query(
          `SELECT id::text AS "featureId", name, ${input.column}::text AS "matchedValue", ${POINT_SQL}
             FROM ${layerView(input.layerKey)}
            WHERE NOT deleted AND ${input.column}::text ILIKE $1
            ORDER BY name NULLS LAST
            LIMIT ${ROW_LIMIT + 1}`,
          [`%${input.value}%`]
        ),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);

      const truncated = allRows.length > ROW_LIMIT;
      const listed = truncated ? allRows.slice(0, ROW_LIMIT) : allRows;

      ctx.provenance({
        tool: 'filter_by_attribute',
        layerKey: input.layerKey,
        rowCount: listed.length,
        datasetVersion,
      });

      if (listed.length === 0) {
        return `Không có dữ liệu: không có ${LAYER_LABELS[input.layerKey]} nào có ${input.column} chứa "${input.value}".`;
      }
      return JSON.stringify({
        layerKey: input.layerKey,
        column: input.column,
        value: input.value,
        truncated,
        rows: listed,
      });
    },
  });
