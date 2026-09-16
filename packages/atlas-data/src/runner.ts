import type { Pool } from 'pg';
import type { Dataset, Stage } from './types';
import { topologicalOrder } from './graph';
import { upsertLineage, appendProcessStep } from './lineage';
import { stageKey, stageHashPlan, readStageState, writeStageState } from './state';
import { executeSql } from './stages/sql';

export interface BuildReport {
  executed: string[];
  skipped: string[];
  failed: string[];
  blocked: string[];
  /** label -> error message, for every entry in `failed`. */
  errors: Record<string, string>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Materialise every dataset, stage by stage, skipping stages whose input hash is
 * unchanged from the last successful run.
 *
 * Per-dataset isolation: an error anywhere in one dataset's processing (lineage upsert,
 * state read/write, a stage's own execution, the process-step append) is caught and
 * recorded against that dataset — it never rejects the overall build, so independent
 * datasets still run. Only a malformed registry (topologicalOrder / stageHashPlan
 * throwing) rejects, since that is not a per-dataset failure.
 */
export async function runBuild(pool: Pool, datasets: Dataset[]): Promise<BuildReport> {
  const report: BuildReport = { executed: [], skipped: [], failed: [], blocked: [], errors: {} };
  const ordered = topologicalOrder(datasets);
  const plan = stageHashPlan(ordered);
  const broken = new Set<string>();

  for (const d of ordered) {
    const labels = d.stages.map((s, i) => `${d.id}/${stageKey(i, s)}`);

    // A dependent cannot be built on a parent that failed. Skip it, but keep going —
    // halting the whole run over one failure wastes an hours-long build.
    if ((d.dependsOn ?? []).some((dep) => broken.has(dep))) {
      broken.add(d.id);
      report.blocked.push(...labels);
      continue;
    }

    const hashes = plan.get(d.id)!;
    let current = `${d.id}/lineage`;
    let failedAt = -1;

    try {
      await upsertLineage(pool, d);

      for (const [i, stage] of d.stages.entries()) {
        current = labels[i];
        const hash = hashes[i];
        const key = stageKey(i, stage);

        const prior = await readStageState(pool, d.id, key);
        if (prior?.status === 'ok' && prior.input_hash === hash) {
          report.skipped.push(current);
          continue;
        }

        try {
          await executeStage(pool, stage);
        } catch (err) {
          report.failed.push(current);
          report.errors[current] = errorMessage(err);
          broken.add(d.id);
          failedAt = i;
          try {
            await writeStageState(pool, d.id, key, hash, 'failed');
          } catch {
            // Best-effort: a failure here must not hide the execution error above.
          }
          break;
        }

        await writeStageState(pool, d.id, key, hash, 'ok');
        // Lineage is written from what actually ran, so it cannot drift (spec §3).
        await appendProcessStep(pool, d.id, `stage ${key} completed`, stage.type);
        report.executed.push(current);
      }

      if (failedAt >= 0) {
        report.blocked.push(...labels.slice(failedAt + 1));
      }
    } catch (err) {
      // Infrastructure error: lineage upsert, a state read/write, or a step append threw
      // outside the stage-execution try above. The dataset is broken; every label from
      // the one being processed onward is unattempted.
      report.failed.push(current);
      report.errors[current] = errorMessage(err);
      broken.add(d.id);
      const idx = labels.indexOf(current);
      report.blocked.push(...labels.slice(idx + 1));
    }
  }

  return report;
}

async function executeStage(pool: Pool, stage: Stage): Promise<void> {
  switch (stage.type) {
    case 'sql':
      return executeSql(pool, stage);
    default:
      // Plan 2 adds fetch-http, load-geojson, publish-geoserver and run.
      throw new Error(`Stage type "${stage.type}" is not implemented yet`);
  }
}
