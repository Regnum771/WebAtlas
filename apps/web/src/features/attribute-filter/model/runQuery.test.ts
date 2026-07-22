import { describe, it, expect } from 'vitest';
import { runQuery, EMPTY_FILTER_MESSAGE } from './runQuery';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

function feat(id: string, props: Record<string, unknown>) {
  return { getId: () => id, getProperties: () => props, getGeometry: () => ({ fake: true }) };
}

// Build a fake map exposing only what runQuery reads.
function makeMap(byLayerKey: Record<string, ReturnType<typeof feat>[] | null>) {
  const layers = Object.entries(byLayerKey).map(([layerKey, feats]) => ({
    get: (k: string) => (k === 'id' ? LAYER_ATTRIBUTE_MAP[layerKey as 'dams'].layerStateId : undefined),
    getSource: () => (feats === null ? null : { getFeatures: () => feats }),
  }));
  return { getLayers: () => ({ getArray: () => layers }) };
}

describe('runQuery', () => {
  it('searches one name condition across all layers and tags each hit', () => {
    const map = makeMap({
      dams: [feat('dams.d1', { geographicalName: 'Thuy dien Song Ba' })],
      rivers: [feat('rivers.r1', { geographicalName: 'Song Ba' })],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: 'all',
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'song ba' }],
    });

    expect(out.hits).toHaveLength(2);
    expect(out.hits.map((h) => h.layerKey).sort()).toEqual(['dams', 'rivers']);
    expect(out.hits.find((h) => h.layerKey === 'rivers')?.layerLabel).toBe('Mạng lưới sông ngòi');
  });

  it('scopes to the named layer and ANDs multiple conditions', () => {
    const map = makeMap({
      dams: [
        feat('dams.d1', { geographicalName: 'A', statusSlug: 'xa_lu', ratedPower: 300 }),
        feat('dams.d2', { geographicalName: 'B', statusSlug: 'xa_lu', ratedPower: 100 }),
        feat('dams.d3', { geographicalName: 'C', statusSlug: 'binh_thuong', ratedPower: 900 }),
      ],
      rivers: [feat('rivers.r1', { geographicalName: 'Song Ba' })],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [
        { field: 'statusSlug', op: 'eq', value: 'xa_lu' },
        { field: 'ratedPower', op: 'gte', value: 200 },
      ],
    });

    expect(out.hits).toHaveLength(1);
    expect(out.hits[0].featureId).toBe('d1');
  });

  it('carries the real feature id so a rebuilt array cannot mis-resolve a hit', () => {
    const map = makeMap({ dams: [feat('dams.abc', { geographicalName: 'A' })] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'a' }],
    });
    expect(out.hits[0].featureId).toBe('abc');
  });

  it('reports layers with no loaded source as unloaded rather than silently omitting them', () => {
    const map = makeMap({
      dams: [feat('dams.d1', { geographicalName: 'A' })],
      rivers: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams', 'rivers'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'a' }],
    });

    expect(out.unloadedLayers).toContain('rivers');
    expect(out.hits).toHaveLength(1);
  });

  it('caps the hits but reports the true total', () => {
    const many = Array.from({ length: 30 }, (_, i) => feat(`dams.d${i}`, { geographicalName: `Dam ${i}` }));
    const map = makeMap({ dams: many });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'dam' }],
    }, 20);

    expect(out.hits).toHaveLength(20);
    expect(out.total).toBe(30);
  });

  it('refuses an empty filter with a message instead of a silent empty list', () => {
    const map = makeMap({ dams: [feat('dams.d1', { geographicalName: 'A' })] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, { layers: 'all', conditions: [] });
    expect(out.hits).toHaveLength(0);
    expect(out.total).toBe(0);
    expect(out.error).toBe(EMPTY_FILTER_MESSAGE);
  });

  it('does NOT report a layer as unloaded when its source loaded but genuinely has zero features', () => {
    const map = makeMap({ dams: [feat('dams.d1', { geographicalName: 'A' })], rivers: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams', 'rivers'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'a' }],
    });

    expect(out.unloadedLayers).not.toContain('rivers');
  });

  it('reports no error once a condition exists', () => {
    const map = makeMap({ dams: [feat('dams.d1', { geographicalName: 'A' })] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = runQuery(map as any, {
      layers: ['dams'],
      conditions: [{ field: 'geographicalName', op: 'contains', value: 'a' }],
    });
    expect(out.error).toBeNull();
  });
});
