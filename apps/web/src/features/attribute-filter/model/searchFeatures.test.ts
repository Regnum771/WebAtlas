import { describe, it, expect } from 'vitest';
import { searchAllLayers } from './searchFeatures';

// Fake map: layers keyed by layerStateId, each source returns stub features.
function feat(name: string, coords: number[] | null = [108, 14]) {
  return {
    getProperties: () => ({ geographicalName: name }),
    getGeometry: () => (coords ? { getExtent: () => [coords[0], coords[1], coords[0], coords[1]] } : null),
  };
}
function fakeMap(byId: Record<string, unknown[]>) {
  const layers = Object.entries(byId).map(([id, features]) => ({
    get: (k: string) => (k === 'id' ? id : undefined),
    getSource: () => ({ getFeatures: () => features }),
  }));
  return { getLayers: () => ({ getArray: () => layers }) };
}

describe('searchAllLayers', () => {
  it('matches feature names across MULTIPLE layers, tagged by layer', () => {
    const map = fakeMap({
      layer_dams: [feat('Đập Sông Ba')],
      layer_rivers: [feat('Sông Ba'), feat('Sông Hinh')],
      layer_stations: [feat('Trạm Sông Ba')],
    });
    const hits = searchAllLayers(map as never, 'sông ba');
    const names = hits.map((h) => h.label);
    expect(names).toContain('Đập Sông Ba');
    expect(names).toContain('Sông Ba');
    expect(names).toContain('Trạm Sông Ba');
    expect(names).not.toContain('Sông Hinh');
    // each hit carries a human layer label
    const river = hits.find((h) => h.label === 'Sông Ba');
    expect(river?.layerLabel).toBe('Mạng lưới sông ngòi');
  });

  it('is case-insensitive', () => {
    const map = fakeMap({ layer_rivers: [feat('Sông Ba')] });
    expect(searchAllLayers(map as never, 'SÔNG').length).toBe(1);
  });

  it('an empty/whitespace query returns nothing', () => {
    const map = fakeMap({ layer_rivers: [feat('Sông Ba')] });
    expect(searchAllLayers(map as never, '   ')).toEqual([]);
  });

  it('a layer with no loaded features contributes nothing (no throw)', () => {
    const map = fakeMap({ layer_dams: [], layer_rivers: [feat('Sông Ba')] });
    expect(searchAllLayers(map as never, 'sông').length).toBe(1);
  });

  it('caps the number of results', () => {
    const many = Array.from({ length: 50 }, (_, i) => feat(`Sông ${i}`));
    const map = fakeMap({ layer_rivers: many });
    expect(searchAllLayers(map as never, 'sông').length).toBeLessThanOrEqual(20);
  });

  it('null map returns nothing', () => {
    expect(searchAllLayers(null as never, 'x')).toEqual([]);
  });
});
