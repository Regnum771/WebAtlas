import { isMapCommand, type AnalysisResult, type EditableLayerKey } from '@webatlas/shared';
import { AppError, NotFoundError, ValidationError } from '../../../../errors';
import { withAnalysisTimeout } from '../../../analysis/db';
import { getAnalysisPool } from '../../../analysis/pool';
import type { ToolContext } from '../types';
import { activeVersionLabel, type Queryable } from './helpers';

/**
 * The assistant face of modules/analysis: same ops as the toolbar, results drawn
 * the same way. Returns the summary only — geometry goes to the map through the
 * command, never through the model, and a 100-sample profile would be pure token cost.
 */
export async function runAnalysisTool(
  ctx: ToolContext,
  tool: string,
  layerKey: EditableLayerKey | null,
  run: (db: Queryable) => Promise<AnalysisResult>
): Promise<string> {
  const datasetVersion = layerKey ? await activeVersionLabel(ctx.pool, layerKey) : null;
  let result: AnalysisResult;
  try {
    // Its own small bounded pool, not ctx.pool: same reasoning as the toolbar's
    // controller.ts — an unauthenticated-shaped, heavy read must not be able to
    // exhaust the app's connection pool (see modules/analysis/pool.ts).
    result = await withAnalysisTimeout(getAnalysisPool(), run);
  } catch (e) {
    ctx.provenance({ tool, layerKey, rowCount: 0, datasetVersion });
    if (e instanceof NotFoundError) return 'Không có dữ liệu: không tìm thấy đối tượng.';
    if (e instanceof ValidationError || (e instanceof AppError && (e.code === 'ANALYSIS_TIMEOUT' || e.code === 'ANALYSIS_BUSY'))) {
      return `Không thực hiện được: ${e.message}`;
    }
    throw e;
  }

  const total = result.summary['Tổng số'];
  const rowCount = typeof total === 'number' ? total : (result.rows?.length ?? 1);
  ctx.provenance({ tool, layerKey, rowCount, datasetVersion });

  const status = result.summary['Trạng thái'];
  if (status === 'Chưa nạp dữ liệu độ cao') {
    return 'Không có dữ liệu: máy chủ này chưa nạp dữ liệu độ cao (DEM).';
  }

  if (result.geometries.length > 0) {
    const command = { kind: 'showGeometries' as const, items: result.geometries, fit: true };
    if (isMapCommand(command)) ctx.collect(command);
  }
  return JSON.stringify({
    summary: result.summary,
    ...(result.rows ? { rows: result.rows } : {}),
    ...(result.truncated ? { truncated: true } : {}),
  });
}
