import type { Pool } from 'pg';
import type { Dataset, Probe, ProbeContext, ProbeResult } from './types';
import { topologicalOrder } from './graph';
import { stageHashPlan } from './state';
import { computeStatusOne } from './status';
import { wfsAnswers } from './probes';

export interface VerifyCheck {
  id: string;
  check: 'stages' | 'probe' | 'layer' | 'lineage';
  ok: boolean;
  detail: string;
}

async function safely(probe: Probe, ctx: ProbeContext): Promise<ProbeResult> {
  try {
    return await probe(ctx);
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Observed behaviour (spec §9): every stage recorded ok, every probe passing, every published layer
 * answering a real WFS request, every dataset with a licensed lineage row. Deliberately not the test
 * suite — a build failing and the code being wrong are read differently.
 */
export async function verifyAtlas(pool: Pool, datasets: Dataset[], ctx: ProbeContext): Promise<VerifyCheck[]> {
  const ordered = topologicalOrder(datasets);
  const plan = stageHashPlan(ordered);
  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  const checks: VerifyCheck[] = [];
  // A database error is a failed check, never an abort: the checks already gathered must still be reported.
  for (const d of ordered) {
    try {
      const s = await computeStatusOne(pool, d, plan.get(d.id)!);
      const unhealthy = s.stages.filter((x) => x.state !== 'ok');
      checks.push({
        id: d.id,
        check: 'stages',
        ok: unhealthy.length === 0,
        detail: unhealthy.length ? unhealthy.map((x) => `${x.key} ${x.state}`).join(', ') : `${s.stages.length} stage(s) ok`,
      });
    } catch (err) {
      checks.push({ id: d.id, check: 'stages', ok: false, detail: message(err) });
    }
    if (d.probe) checks.push({ id: d.id, check: 'probe', ...(await safely(d.probe, ctx)) });
    for (const stage of d.stages) {
      if (stage.type === 'publish-geoserver') {
        checks.push({ id: d.id, check: 'layer', ...(await safely(wfsAnswers(stage.layer), ctx)) });
      }
    }
    try {
      const { rows } = await pool.query<{ licence: string }>(
        'SELECT licence FROM app.dataset_lineage WHERE dataset_id = $1',
        [d.id]
      );
      const licence = rows[0]?.licence ?? '';
      checks.push({
        id: d.id,
        check: 'lineage',
        ok: licence.length > 0,
        detail: licence ? `licence ${licence}` : 'no lineage row — build or adopt the dataset',
      });
    } catch (err) {
      checks.push({ id: d.id, check: 'lineage', ok: false, detail: message(err) });
    }
  }
  return checks;
}

export function formatVerify(checks: VerifyCheck[]): { lines: string[]; ok: boolean } {
  const lines = checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(20)} ${c.check.padEnd(8)} ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  lines.push(failed === 0 ? `all ${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`);
  return { lines, ok: failed === 0 };
}
