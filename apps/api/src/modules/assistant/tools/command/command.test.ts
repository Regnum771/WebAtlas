import { describe, it, expect, vi } from 'vitest';
import type { MapCommand, MapContext } from '@webatlas/shared';
import { isMapCommand } from '@webatlas/shared';
import type { ToolContext } from '../types';
import { zoomToRegionTool } from './zoomToRegion';
import { zoomToFeatureTool } from './zoomToFeature';
import { setLayerVisibleTool } from './setLayerVisible';
import { setBasemapTool } from './setBasemap';
import { highlightFeaturesTool } from './highlightFeatures';

const KNOWN_ID = '6f1c2a54-2b0e-4d8c-9d61-1f4f1f0c2a11';
vi.mock('../data/helpers', async (orig) => ({
  ...(await orig<typeof import('../data/helpers')>()),
  resolveFeature: vi.fn(async (_db: unknown, _layerKey: string, featureId: string) =>
    featureId === '6f1c2a54-2b0e-4d8c-9d61-1f4f1f0c2a11'
      ? {
          featureId, name: 'Sông Ba', lon: 108.3, lat: 13.2, properties: {},
          geometry: { type: 'LineString', coordinates: [[108, 13], [108.5, 13.4]] },
        }
      : null),
}));

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

function makeCtx() {
  const collected: MapCommand[] = [];
  const ctx = {
    pool: {} as ToolContext['pool'],
    mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => collected.push(c)),
    provenance: vi.fn(),
    role: 'viewer',
  } satisfies ToolContext;
  return { ctx, collected };
}

/** The runner calls tools through `.run`; these tests call it the same way. */
function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never) as string);
}

describe('command tools', () => {
  it('zoomToRegion collects a valid command and confirms in Vietnamese', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(zoomToRegionTool(ctx), { provinceCode: '66' });
    expect(collected).toEqual([{ kind: 'zoomToRegion', provinceCode: '66' }]);
    expect(collected.every(isMapCommand)).toBe(true);
    expect(text).toContain('Đắk Lắk');
  });

  it('zoomToRegion refuses a province outside the working region without collecting', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(zoomToRegionTool(ctx), { provinceCode: '01' });
    expect(collected).toEqual([]);
    expect(text).toContain('không thuộc vùng công tác');
  });

  it('zoomToFeature collects coordinates the data tools produced', async () => {
    const { ctx, collected } = makeCtx();
    await run(zoomToFeatureTool(ctx), {
      layerKey: 'dams', featureId: 'abc', lon: 108.1, lat: 12.7,
    });
    expect(collected).toEqual([
      { kind: 'zoomToFeature', layerKey: 'dams', featureId: 'abc', lonLat: [108.1, 12.7] },
    ]);
  });

  it('zoomToFeature refuses coordinates outside Vietnam', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(zoomToFeatureTool(ctx), {
      layerKey: 'dams', featureId: 'abc', lon: 0, lat: 0,
    });
    expect(collected).toEqual([]);
    expect(text).toContain('Toạ độ không hợp lệ');
  });

  it('setLayerVisible collects a toggle for a known layer', async () => {
    const { ctx, collected } = makeCtx();
    await run(setLayerVisibleTool(ctx), { layerStateId: 'layer_rivers', visible: true });
    expect(collected).toEqual([{ kind: 'setLayerVisible', layerStateId: 'layer_rivers', visible: true }]);
  });

  it('setLayerVisible refuses an unknown layer id without collecting', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(setLayerVisibleTool(ctx), { layerStateId: 'layer_nope', visible: true });
    expect(collected).toEqual([]);
    expect(text).toContain('Không có lớp');
  });

  it('setBasemap collects a basemap change', async () => {
    const { ctx, collected } = makeCtx();
    await run(setBasemapTool(ctx), { basemap: 'satellite' });
    expect(collected).toEqual([{ kind: 'setBasemap', basemap: 'satellite' }]);
  });

  it('highlightFeatures collects the points it was given', async () => {
    const { ctx, collected } = makeCtx();
    await run(highlightFeaturesTool(ctx), {
      points: [{ lon: 108.1, lat: 12.7, label: 'Đập A' }],
    });
    expect(collected).toEqual([
      { kind: 'highlightFeatures', points: [{ lonLat: [108.1, 12.7], label: 'Đập A' }] },
    ]);
  });

  it('highlightFeatures drops points outside Vietnam rather than drawing them', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), {
      points: [{ lon: 108.1, lat: 12.7 }, { lon: 0, lat: 0 }],
    });
    expect(collected).toEqual([{ kind: 'highlightFeatures', points: [{ lonLat: [108.1, 12.7] }] }]);
    expect(text).toContain('1');
  });

  it('highlightFeatures collects nothing when every point is invalid', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), { points: [{ lon: 0, lat: 0 }] });
    expect(collected).toEqual([]);
    expect(text).toContain('Không có toạ độ hợp lệ');
  });

  it('every collected command passes the shared validator', async () => {
    const { ctx, collected } = makeCtx();
    await run(zoomToRegionTool(ctx), { provinceCode: '48' });
    await run(setBasemapTool(ctx), { basemap: 'dem' });
    await run(setLayerVisibleTool(ctx), { layerStateId: 'layer_lakes', visible: false });
    expect(collected).toHaveLength(3);
    expect(collected.every(isMapCommand)).toBe(true);
  });

  it('highlightFeatures resolves feature references into drawn, framed geometry', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), {
      featureRefs: [{ layerKey: 'rivers', featureId: KNOWN_ID }],
    });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ kind: 'showGeometries', fit: true });
    expect(collected.every(isMapCommand)).toBe(true);
    expect(text).toContain('Đã tô sáng 1 đối tượng');
  });

  it('highlightFeatures reports references it could not find without collecting', async () => {
    const { ctx, collected } = makeCtx();
    const text = await run(highlightFeaturesTool(ctx), {
      featureRefs: [{ layerKey: 'rivers', featureId: '00000000-0000-0000-0000-000000000000' }],
    });
    expect(collected).toEqual([]);
    expect(text).toContain('Không có dữ liệu');
  });
});
