import type { Pool } from 'pg';
import type { Dataset, Probe, ProbeContext, ProbeResult } from './types';
import { computeStatus } from './status';
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
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const checks: VerifyCheck[] = [];
  for (const s of await computeStatus(pool, datasets)) {
    const d = byId.get(s.id)!;
    const unhealthy = s.stages.filter((x) => x.state !== 'ok');
    checks.push({
      id: d.id,
      check: 'stages',
      ok: unhealthy.length === 0,
      detail: unhealthy.length ? unhealthy.map((x) => `${x.key} ${x.state}`).join(', ') : `${s.stages.length} stage(s) ok`,
    });
    if (d.probe) checks.push({ id: d.id, check: 'probe', ...(await safely(d.probe, ctx)) });
    for (const stage of d.stages) {
      if (stage.type === 'publish-geoserver') {
        checks.push({ id: d.id, check: 'layer', ...(await safely(wfsAnswers(stage.layer), ctx)) });
      }
    }
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
  }
  return checks;
}

export function formatVerify(checks: VerifyCheck[]): { lines: string[]; ok: boolean } {
  const lines = checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(20)} ${c.check.padEnd(8)} ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  lines.push(failed === 0 ? `all ${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`);
  return { lines, ok: failed === 0 };
}
