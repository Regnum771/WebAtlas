import type { Pool } from 'pg';
import type { Dataset, ProbeContext, ProbeResult } from './types';
import { topologicalOrder } from './graph';
import { stageKey, stageHashPlan, readStageState, writeStageState } from './state';
import { upsertLineage, appendProcessStep, adoptionStep } from './lineage';

export type AdoptResult = 'adopted' | 'has-state' | 'no-probe' | 'probe-failed';

export interface AdoptOutcome {
  id: string;
  result: AdoptResult;
  detail: string;
}

/**
 * Record an already-built machine as built without running anything (spec FR-13, UC-10). A dataset
 * with no stage state whose probe passes gets every stage written `ok` at its current planned hash,
 * plus one process step saying so. Anything that already has state is left to atlas:build, which
 * knows whether it is stale. Never executes a stage.
 */
export async function adoptDatasets(pool: Pool, datasets: Dataset[], ctx: ProbeContext): Promise<AdoptOutcome[]> {
  const ordered = topologicalOrder(datasets);
  const plan = stageHashPlan(ordered);
  const out: AdoptOutcome[] = [];

  for (const d of ordered) {
    const keys = d.stages.map((s, i) => stageKey(i, s));

    let tracked = false;
    for (const key of keys) {
      if (await readStageState(pool, d.id, key)) {
        tracked = true;
        break;
      }
    }
    if (tracked) {
      out.push({ id: d.id, result: 'has-state', detail: 'already tracked; atlas:build decides what to redo' });
      continue;
    }
    if (!d.probe) {
      out.push({ id: d.id, result: 'no-probe', detail: 'declares no probe; atlas:build will build it' });
      continue;
    }

    let r: ProbeResult;
    try {
      r = await d.probe(ctx);
    } catch (err) {
      r = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (!r.ok) {
      out.push({ id: d.id, result: 'probe-failed', detail: r.detail });
      continue;
    }

    // Lineage row first: process steps reference it (ON DELETE RESTRICT).
    await upsertLineage(pool, d);
    const step = adoptionStep(r.detail);
    await appendProcessStep(pool, d.id, step.description, step.tool);
    const hashes = plan.get(d.id)!;
    for (const [i, key] of keys.entries()) await writeStageState(pool, d.id, key, hashes[i], 'ok');
    out.push({ id: d.id, result: 'adopted', detail: r.detail });
  }

  return out;
}
