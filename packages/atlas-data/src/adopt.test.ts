import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Dataset, ProbeContext } from './types';
import { stageHashPlan } from './state';

vi.mock('./stages/index', () => ({ executeStage: vi.fn(), hasExecutor: () => true }));
import { executeStage } from './stages/index';
// Re-labelling has its own database test (adoptLegacy.db.test.ts); here it is a stub.
vi.mock('./adoptLegacy', () => ({ adoptLegacySource: vi.fn() }));
import { adoptLegacySource } from './adoptLegacy';
import { adoptDatasets } from './adopt';

/** In-memory stage state and lineage, enough for adoption. */
function memoryPool(seed: Record<string, { input_hash: string; status: string }> = {}) {
  const state = new Map(Object.entries(seed));
  const steps: Array<{ id: string; description: string; tool: string }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM app.dataset_stage_state')) {
      const row = state.get(`${params[0]}|${params[1]}`);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INTO app.dataset_stage_state')) {
      state.set(`${params[0]}|${params[1]}`, { input_hash: params[2] as string, status: params[3] as string });
      return { rows: [] };
    }
    if (sql.includes('INTO app.dataset_lineage_step')) {
      steps.push({ id: params[0] as string, description: params[1] as string, tool: params[2] as string });
      return { rows: [] };
    }
    return { rows: [] };
  });
  const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
  return { pool, state, steps };
}

const ds = (id: string, probe?: Dataset['probe']): Dataset => ({
  id, kind: 'derived', lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  stages: [{ type: 'sql', statement: 'SELECT 1' }, { type: 'sql', statement: 'SELECT 2' }],
  probe,
});
/** A versioned layer dataset over a seed file that exists, so the stage hash can be planned. */
const layerDs = (probe: Dataset['probe']): Dataset => ({
  id: 'stations', kind: 'vector', lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  stages: [{
    type: 'load-geojson', layer: 'stations', versioned: true, legacySource: 'stations.geojson',
    files: [{ file: 'seeds/stations.geojson', columns: () => ({}) }],
  }],
  probe,
});
const ctx = {} as ProbeContext;

describe('adoptDatasets', () => {
  it('records every stage ok at its planned hash, and a process step, without executing anything', async () => {
    const m = memoryPool();
    const d = ds('basemap', async () => ({ ok: true, detail: 'roads: 5' }));
    const out = await adoptDatasets(m.pool, [d], ctx);
    const hashes = stageHashPlan([d]).get('basemap')!;
    expect(out).toEqual([{ id: 'basemap', result: 'adopted', detail: 'roads: 5' }]);
    expect(m.state.get('basemap|0:sql')).toEqual({ input_hash: hashes[0], status: 'ok' });
    expect(m.state.get('basemap|1:sql')).toEqual({ input_hash: hashes[1], status: 'ok' });
    expect(m.steps).toEqual([{ id: 'basemap', description: 'adopted without executing · roads: 5', tool: 'atlas:adopt' }]);
    expect(executeStage).not.toHaveBeenCalled();
  });

  it('leaves a dataset that already has state alone — atlas:build decides', async () => {
    const m = memoryPool({ 'rivers|0:sql': { input_hash: 'old', status: 'ok' } });
    const probe = vi.fn(async () => ({ ok: true, detail: 'x' }));
    const out = await adoptDatasets(m.pool, [ds('rivers', probe)], ctx);
    expect(out[0].result).toBe('has-state');
    expect(probe).not.toHaveBeenCalled();
    expect(m.state.get('rivers|0:sql')?.input_hash).toBe('old');
  });

  it('adopts nothing when the probe fails, or throws, or is missing', async () => {
    const m = memoryPool();
    const out = await adoptDatasets(
      m.pool,
      [
        ds('a', async () => ({ ok: false, detail: 'roads: 0 (expected ≥ 1)' })),
        ds('b', async () => { throw new Error('GEOSERVER_URL is not set'); }),
        ds('c'),
      ],
      ctx
    );
    expect(out.map((o) => [o.id, o.result, o.detail])).toEqual([
      ['a', 'probe-failed', 'roads: 0 (expected ≥ 1)'],
      ['b', 'probe-failed', 'GEOSERVER_URL is not set'],
      ['c', 'no-probe', 'declares no probe; atlas:build will build it'],
    ]);
    expect(m.state.size).toBe(0);
    expect(m.steps).toEqual([]);
  });

  it('leaves a layer for the build when its existing version cannot be shown to be this content', async () => {
    vi.mocked(adoptLegacySource).mockResolvedValueOnce({
      result: 'mismatch', detail: 'stations: the active load holds 1 rows, the files hold 2 features',
    });
    const m = memoryPool();
    const out = await adoptDatasets(m.pool, [layerDs(async () => ({ ok: true, detail: 'water.stations_active: 2' }))], ctx);
    expect(out).toEqual([{
      id: 'stations', result: 'needs-build',
      detail: 'stations: the active load holds 1 rows, the files hold 2 features; atlas:build will load it',
    }]);
    // Nothing recorded: the next build must run the load.
    expect(m.state.size).toBe(0);
    expect(m.steps).toEqual([]);
  });

  it('adopts a layer whose existing version was re-labelled, or was already current', async () => {
    for (const adoption of [{ result: 'relabelled' as const, versionId: 'v1' }, { result: 'current' as const, versionId: 'v1' }]) {
      vi.mocked(adoptLegacySource).mockResolvedValueOnce(adoption);
      const m = memoryPool();
      const d = layerDs(async () => ({ ok: true, detail: 'water.stations_active: 2' }));
      const out = await adoptDatasets(m.pool, [d], ctx);
      expect(out[0].result).toBe('adopted');
      expect(m.state.get('stations|0:load-geojson')).toEqual({ input_hash: stageHashPlan([d]).get('stations')![0], status: 'ok' });
    }
  });

  it('re-labels the version of a tracked dataset whose load stage is new, so the build does not reload it', async () => {
    // rivers on a machine built before load-geojson: its publish stages have state under the same
    // keys, its load stage has none. Skipping it as "tracked" would make the next build load all
    // of it again as a new version.
    vi.mocked(adoptLegacySource).mockClear();
    vi.mocked(adoptLegacySource).mockResolvedValueOnce({ result: 'relabelled', versionId: 'v1' });
    const d: Dataset = {
      ...layerDs(async () => ({ ok: true, detail: 'x' })),
      stages: [...layerDs(undefined).stages, { type: 'publish-geoserver', layer: 'stations' }],
    };
    const m = memoryPool({ 'stations|1:publish-geoserver': { input_hash: 'old', status: 'ok' } });
    const out = await adoptDatasets(m.pool, [d], ctx);
    expect(adoptLegacySource).toHaveBeenCalledTimes(1);
    expect(out[0].result).toBe('has-state');
    expect(out[0].detail).toMatch(/re-labelled/);
    // State is untouched: the build decides, and its load will find the content already there.
    expect(m.state.size).toBe(1);
  });

  it('does not touch the version of a tracked dataset whose load stage already has state', async () => {
    vi.mocked(adoptLegacySource).mockClear();
    const d = layerDs(async () => ({ ok: true, detail: 'x' }));
    const m = memoryPool({ 'stations|0:load-geojson': { input_hash: 'old', status: 'ok' } });
    const out = await adoptDatasets(m.pool, [d], ctx);
    expect(adoptLegacySource).not.toHaveBeenCalled();
    expect(out[0]).toEqual({ id: 'stations', result: 'has-state', detail: 'already tracked; atlas:build decides what to redo' });
  });
});
