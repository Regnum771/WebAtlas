import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Dataset, ProbeContext } from './types';
import { stageHashPlan } from './state';
import { formatVerify, verifyAtlas } from './verify';

const d: Dataset = {
  id: 'rivers', kind: 'vector', lineage: { statement: 's', licence: 'ODbL-1.0', sources: [] },
  stages: [{ type: 'sql', statement: 'SELECT 1' }, { type: 'publish-geoserver', layer: 'rivers', nativeName: 'rivers_detail' }],
  probe: async () => ({ ok: true, detail: 'level-1 rivers: 588' }),
};
const hashes = stageHashPlan([d]).get('rivers')!;

function pool(opts: { state?: 'ok' | 'none'; licence?: string | null }) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM app.dataset_stage_state')) {
        if (opts.state === 'none') return { rows: [] };
        const i = params[1] === '0:sql' ? 0 : 1;
        return { rows: [{ input_hash: hashes[i], status: 'ok' }] };
      }
      if (sql.includes('FROM app.dataset_lineage')) return { rows: opts.licence ? [{ licence: opts.licence }] : [] };
      return { rows: [] };
    }),
  } as unknown as Pool;
}
const ctx = (wfsFeatures: number): ProbeContext => ({
  pool: {} as Pool,
  geoserver: async () => new Response(JSON.stringify({ features: Array(wfsFeatures).fill({}) }), { status: 200 }),
});

describe('verifyAtlas (spec §9)', () => {
  it('passes when stages are ok, the probe passes, the layer serves and lineage has a licence', async () => {
    const checks = await verifyAtlas(pool({ licence: 'ODbL-1.0' }), [d], ctx(1));
    expect(checks.map((c) => [c.check, c.ok])).toEqual([['stages', true], ['probe', true], ['layer', true], ['lineage', true]]);
    expect(formatVerify(checks).ok).toBe(true);
  });

  it('reports each broken check, so disagreement between status and behaviour is visible', async () => {
    const checks = await verifyAtlas(pool({ state: 'none', licence: null }), [d], ctx(0));
    const byCheck = Object.fromEntries(checks.map((c) => [c.check, c]));
    expect(byCheck.stages).toMatchObject({ ok: false, detail: '0:sql missing, 1:publish-geoserver missing' });
    expect(byCheck.layer).toMatchObject({ ok: false, detail: 'webatlas:rivers WFS returned no features' });
    expect(byCheck.lineage).toMatchObject({ ok: false, detail: 'no lineage row — build or adopt the dataset' });
    const { lines, ok } = formatVerify(checks);
    expect(ok).toBe(false);
    expect(lines.at(-1)).toMatch(/^3 of 4 checks failed$/);
  });
});
