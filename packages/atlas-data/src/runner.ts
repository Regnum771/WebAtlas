import type { Pool } from 'pg';
import type { Dataset } from './types';
import { topologicalOrder } from './graph';
import { upsertLineage, appendProcessStep } from './lineage';
import { stageKey, stageInputHash, readStageState, writeStageState } from './state';
import { executeSql } from './stages/sql';

export interface BuildReport {
  executed: string[];
  skipped: string[];
  failed: string[];
  blocked: string[];
}

export async function runBuild(pool: Pool, datasets: Dataset[]): Promise<BuildReport> {
  const report: BuildReport = { executed: [], skipped: [], failed: [], blocked: [] };
  const hashes = new Map<string, string>();   // dataset id -> last stage hash
  const broken = new Set<string>();           // datasets that failed or are downstream of one

  for (const d of topologicalOrder(datasets)) {
    // A dependent cannot be built on a parent that failed. Skip it, but keep going —
    // halting the whole run over one failure wastes an hours-long build.
    if ((d.dependsOn ?? []).some((dep) => broken.has(dep))) {
      broken.add(d.id);
      report.blocked.push(d.id);
      continue;
    }

    await upsertLineage(pool, d);
    const upstream = (d.dependsOn ?? []).map((dep) => hashes.get(dep) ?? '');
    let datasetFailed = false;

    for (const [i, stage] of d.stages.entries()) {
      const key = stageKey(i, stage);
      const label = `${d.id}/${key}`;
      const hash = stageInputHash(stage, upstream);

      const prior = await readStageState(pool, d.id, key);
      if (prior?.status === 'ok' && prior.input_hash === hash) {
        report.skipped.push(label);
        hashes.set(d.id, hash);
        continue;
      }

      try {
        await executeStage(pool, stage);
      } catch {
        await writeStageState(pool, d.id, key, hash, 'failed');
        report.failed.push(label);
        broken.add(d.id);
        datasetFailed = true;
        break;
      }

      await writeStageState(pool, d.id, key, hash, 'ok');
      // Lineage is written from what actually ran, so it cannot drift (spec §3).
      await appendProcessStep(pool, d.id, `stage ${key} completed`, stage.type);
      report.executed.push(label);
      hashes.set(d.id, hash);
    }

    if (datasetFailed) continue;
  }

  return report;
}

async function executeStage(pool: Pool, stage: Dataset['stages'][number]): Promise<void> {
  switch (stage.type) {
    case 'sql':
      return executeSql(pool, stage);
    default:
      // Plan 2 adds fetch-http, load-geojson, publish-geoserver and run.
      throw new Error(`Stage type "${stage.type}" is not implemented yet`);
  }
}
