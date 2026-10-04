import type { Pool } from 'pg';
import type { Dataset, ProbeContext, ProbeResult, Stage } from './types';
import { topologicalOrder } from './graph';
import { stageKey, stageHashPlan, readStageState, writeStageState } from './state';
import { upsertLineage, appendProcessStep, adoptionStep } from './lineage';
import { adoptLegacySource } from './adoptLegacy';
import { resolveLoad } from './stages/loadGeojson';

export type AdoptResult = 'adopted' | 'has-state' | 'no-probe' | 'probe-failed' | 'needs-build';

export interface AdoptOutcome {
  id: string;
  result: AdoptResult;
  detail: string;
}

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

/**
 * Re-label the existing versions of these layers with their content-derived source, all or none:
 * one transaction, rolled back at the first layer that cannot be shown to hold this content.
 * Returns the reason it was refused, or undefined when every layer is now current.
 */
async function relabel(pool: Pool, loads: LoadStage[]): Promise<string | undefined> {
  const client = await pool.connect();
  let refused: string | undefined;
  try {
    await client.query('BEGIN');
    for (const s of loads) {
      const a = await adoptLegacySource(client, s, resolveLoad(s));
      if (a.result === 'mismatch') {
        refused = a.detail;
        break;
      }
    }
    await client.query(refused ? 'ROLLBACK' : 'COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return refused;
}

/**
 * Record an already-built machine as built without running anything (spec FR-13, UC-10). A dataset
 * with no stage state whose probe passes gets every stage written `ok` at its current planned hash,
 * plus one process step saying so. Anything that already has state is left to atlas:build, which
 * knows whether it is stale. Never executes a stage.
 *
 * A versioned layer needs more than a passing probe: its existing version must be shown to be the
 * content the descriptor loads, and is then re-labelled with the content-derived source
 * (adoptLegacySource). If it cannot be, the dataset is left for the build (`needs-build`).
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
    const versionedLoads = d.stages
      .map((s, i) => ({ s, key: keys[i] }))
      .filter((x): x is { s: LoadStage; key: string } => x.s.type === 'load-geojson' && x.s.versioned);

    if (tracked) {
      // Tracked, but a load stage may still be new to this machine: rivers kept its publish stages
      // (and their state) when its first stage became a load-geojson. Its existing version is
      // re-labelled all the same, or the build would load every feature again as a new version.
      // State is left alone: the build runs that load, finds the content there, and re-stamps.
      const fresh: LoadStage[] = [];
      for (const { s, key } of versionedLoads) if (!(await readStageState(pool, d.id, key))) fresh.push(s);
      let note = '';
      if (fresh.length > 0) {
        const refused = await relabel(pool, fresh);
        note = refused
          ? `; ${refused}, so the build will load it`
          : '; its existing version was re-labelled, so the build will not load it again';
      }
      out.push({ id: d.id, result: 'has-state', detail: `already tracked; atlas:build decides what to redo${note}` });
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

    // A versioned layer is adopted only if its existing version can be shown to be this content.
    // Otherwise the dataset is left for the build, which loads one new version (the edit guard
    // still applies).
    if (versionedLoads.length > 0) {
      const refused = await relabel(pool, versionedLoads.map((x) => x.s));
      if (refused) {
        out.push({ id: d.id, result: 'needs-build', detail: `${refused}; atlas:build will load it` });
        continue;
      }
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
