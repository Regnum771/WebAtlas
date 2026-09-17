import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { isMapCommand, type MapCommand, type Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { proposeFeatureUpdateTool } from './proposeFeatureUpdate';

let pool: Pool;
let damId: string;
let damName: string;

beforeAll(async () => {
  pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id::text, name FROM water.dams_active WHERE wattage_mw IS NOT NULL AND name IS NOT NULL LIMIT 1`
  );
  damId = rows[0].id;
  damName = rows[0].name;
});
afterAll(async () => { await closePool(); });

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool,
    role: 'admin',
    mapContext: { bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street' },
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}

const run = (tool: { run: (i: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

describe('propose_feature_update', () => {
  it('collects a highlight then a valid proposal carrying current and proposed values', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), {
      layerKey: 'dams', featureId: damId,
      changes: { wattage_mw: '9999' },
      sourceDocument: 'Quyết định 123/QĐ-UBND', sourceProvider: 'Sở Công Thương',
    });
    expect(commands.map((c) => c.kind)).toEqual(['showGeometries', 'proposeFeatureEdit']);
    expect(commands.every(isMapCommand)).toBe(true);
    const proposal = commands[1] as Extract<MapCommand, { kind: 'proposeFeatureEdit' }>;
    expect(proposal.name).toBe(damName);
    expect(proposal.proposed).toEqual({ wattage_mw: '9999' });
    expect(proposal.current).toHaveProperty('wattage_mw');
    expect(proposal.current).not.toHaveProperty('external_id');
    expect(proposal.sourceDocument).toBe('Quyết định 123/QĐ-UBND');
    expect(records[0]).toMatchObject({ tool: 'propose_feature_update', layerKey: 'dams', rowCount: 1 });
    expect(text).toContain('Lưu');
    expect(text).not.toContain('Còn thiếu');
  });

  it('asks for missing source information', async () => {
    const { ctx } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), { layerKey: 'dams', featureId: damId, changes: { wattage_mw: '9999' } });
    expect(text).toContain('Còn thiếu');
    expect(text).toContain('tài liệu nguồn');
    expect(text).toContain('người cung cấp');
  });

  it('rejects unknown columns and names the valid ones, collecting nothing', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), { layerKey: 'dams', featureId: damId, changes: { capacity: '72' } });
    expect(commands).toEqual([]);
    expect(text).toContain('capacity');
    expect(text).toContain('wattage_mw');
  });

  it('reports no data for an unknown feature and still emits provenance', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), {
      layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000', changes: { name: 'x' },
    });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(commands).toEqual([]);
    expect(records[0]).toMatchObject({ rowCount: 0 });
  });

  it('says there is nothing to change when proposed values equal current ones', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(proposeFeatureUpdateTool(ctx), { layerKey: 'dams', featureId: damId, changes: { name: damName } });
    expect(commands).toEqual([]);
    expect(text).toContain('trùng');
  });
});
