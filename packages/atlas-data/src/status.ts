import type { Pool } from 'pg';
import type { Dataset } from './types';
import { topologicalOrder } from './graph';
import { stageKey, stageHashPlan, readStageState } from './state';

export type StageState = 'ok' | 'stale' | 'missing' | 'failed';

export interface DatasetStatus {
  id: string;
  state: StageState;
  stages: Array<{ key: string; state: StageState }>;
}

/** Worst first: a dataset is as healthy as its least healthy stage. */
const ORDER: StageState[] = ['failed', 'missing', 'stale', 'ok'];

/** Declared state (spec §4): what the registry believes, from the same hash plan the runner uses. */
export async function computeStatus(pool: Pool, datasets: Dataset[]): Promise<DatasetStatus[]> {
  const ordered = topologicalOrder(datasets);
  const plan = stageHashPlan(ordered);
  const out: DatasetStatus[] = [];
  for (const d of ordered) {
    const hashes = plan.get(d.id)!;
    const stages: DatasetStatus['stages'] = [];
    for (const [i, stage] of d.stages.entries()) {
      const key = stageKey(i, stage);
      const prior = await readStageState(pool, d.id, key);
      const state: StageState = !prior
        ? 'missing'
        : prior.status !== 'ok'
          ? 'failed'
          : prior.input_hash !== hashes[i]
            ? 'stale'
            : 'ok';
      stages.push({ key, state });
    }
    out.push({ id: d.id, state: ORDER.find((s) => stages.some((st) => st.state === s)) ?? 'ok', stages });
  }
  return out;
}

function suggestion(rows: DatasetStatus[]): string {
  const failed = rows.filter((r) => r.state === 'failed').map((r) => r.id);
  if (failed.length > 0) {
    return `npm run atlas:build -- --only ${failed.join(',')}   (retries the failed stage; the build output has the error)`;
  }
  if (rows.some((r) => r.state === 'missing' || r.state === 'stale')) {
    return 'npm run atlas:build   (or npm run atlas:adopt first, if this machine already holds the data)';
  }
  return 'npm run atlas:verify   (everything is recorded as built; check it actually serves)';
}

export function formatStatus(rows: DatasetStatus[]): string[] {
  const lines: string[] = [];
  for (const group of ORDER) {
    const inGroup = rows.filter((r) => r.state === group);
    if (inGroup.length === 0) continue;
    lines.push(`${group.padEnd(8)}${inGroup.map((r) => r.id).join(', ')}`);
    if (group === 'ok') continue;
    for (const r of inGroup) {
      const unhealthy = r.stages.filter((s) => s.state !== 'ok').map((s) => `${s.key} ${s.state}`);
      lines.push(`          ${r.id}: ${unhealthy.join(', ')}`);
    }
  }
  lines.push(`next: ${suggestion(rows)}`);
  return lines;
}
