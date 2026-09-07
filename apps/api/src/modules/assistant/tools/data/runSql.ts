// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { guardSql } from '../../sql/guard';
import { getAssistantPool } from '../../sql/pool';

const VIEWS = EDITABLE_LAYER_KEYS.map((k) => `water.${k}_active`).join(', ');

export const runSqlTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'run_sql',
    description:
      `Last resort for questions the typed tools cannot express (aggregates, groupings, numeric ranges). Read-only SELECT against these views only: ${VIEWS}. Every column of the underlying layer is available. Prefer a typed tool whenever one fits.`,
    inputSchema: z.object({
      sql: z.string().describe('A single read-only SELECT or WITH statement. No comments, no semicolons.'),
      purpose: z.string().max(200).describe('One Vietnamese sentence: what this query answers.'),
    }),
    run: async (input) => {
      const pool = getAssistantPool();
      if (!pool) return 'Công cụ SQL chưa được cấu hình trên máy chủ này. Hãy dùng công cụ khác.';

      const guarded = guardSql(input.sql);
      if (!guarded.ok) return `Truy vấn bị từ chối: ${guarded.reason}`;

      const client = await pool.connect();
      try {
        // READ ONLY on BEGIN, not `SET LOCAL default_transaction_read_only`:
        // that GUC only affects transactions started afterwards, so setting it
        // inside the transaction it is meant to constrain does nothing.
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '3s'");
        // Keeps app out of the default resolution path. Ergonomics, not a
        // boundary — the boundary is the role's grants.
        await client.query('SET LOCAL search_path = water, public');
        const result = await client.query(guarded.sql);
        await client.query('COMMIT');

        // The generated SQL goes into provenance so a reviewer can see exactly
        // what ran. That visibility is the condition on which the escape hatch
        // is acceptable at all.
        ctx.provenance({
          tool: 'run_sql',
          layerKey: null,
          rowCount: result.rowCount ?? 0,
          datasetVersion: null,
          sql: guarded.sql,
        });

        if ((result.rowCount ?? 0) === 0) {
          return 'Không có dữ liệu: truy vấn không trả về dòng nào.';
        }
        return JSON.stringify({ purpose: input.purpose, rowCount: result.rowCount, rows: result.rows });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        const detail = e instanceof Error ? e.message : 'lỗi không rõ';
        return `Truy vấn thất bại: ${detail}. Hãy thử công cụ có sẵn thay vì SQL.`;
      } finally {
        client.release();
      }
    },
  });
