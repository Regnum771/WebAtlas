import { describe, it, expect, vi } from 'vitest';
import type { Map } from 'ol';
import { showHighlights, clearHighlights, HIGHLIGHT_LAYER_ID, showResults, RESULTS_LAYER_ID } from './highlightLayer';
import { fromLonLat } from 'ol/proj';

function makeMap() {
  const added: unknown[] = [];
  const map = { addLayer: vi.fn((l: unknown) => added.push(l)) } as unknown as Map;
  return { map, added };
}

function makeMapWithView() {
  const added: Array<{ get: (k: string) => unknown; getSource: () => { getFeatures: () => unknown[] } }> = [];
  const fit = vi.fn();
  const map = {
    addLayer: vi.fn((l) => added.push(l)),
    getView: () => ({ fit }),
    getSize: () => [800, 600],
  } as unknown as Map;
  return { map, added, fit };
}

describe('highlightLayer', () => {
  it('adds exactly one layer to the map however many times it is called', () => {
    const { map } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    showHighlights(map, [{ lonLat: [108.2, 12.8] }]);
    expect((map.addLayer as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('tags the layer so it is identifiable in the layer stack', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    const layer = added[0] as { get: (k: string) => unknown };
    expect(layer.get('id')).toBe(HIGHLIGHT_LAYER_ID);
  });

  it('replaces the previous highlights rather than accumulating them', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }, { lonLat: [108.2, 12.8] }]);
    showHighlights(map, [{ lonLat: [108.3, 12.9] }]);
    const source = (added[0] as { getSource: () => { getFeatures: () => unknown[] } }).getSource();
    expect(source.getFeatures()).toHaveLength(1);
  });

  it('projects lonLat into the map projection', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    const source = (added[0] as { getSource: () => { getFeatures: () => Array<{ getGeometry: () => { getCoordinates: () => number[] } }> } }).getSource();
    expect(source.getFeatures()[0].getGeometry().getCoordinates()).toEqual(fromLonLat([108.1, 12.7]));
  });

  it('carries the label through as a feature property', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7], label: 'Đập Buôn Kuốp' }]);
    const source = (added[0] as { getSource: () => { getFeatures: () => Array<{ get: (k: string) => unknown }> } }).getSource();
    expect(source.getFeatures()[0].get('label')).toBe('Đập Buôn Kuốp');
  });

  it('clearHighlights empties the source without removing the layer', () => {
    const { map, added } = makeMap();
    showHighlights(map, [{ lonLat: [108.1, 12.7] }]);
    clearHighlights(map);
    const source = (added[0] as { getSource: () => { getFeatures: () => unknown[] } }).getSource();
    expect(source.getFeatures()).toHaveLength(0);
    expect((map.addLayer as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('clearHighlights on a map that never highlighted anything does nothing', () => {
    const { map } = makeMap();
    expect(() => clearHighlights(map)).not.toThrow();
    expect((map.addLayer as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('showResults', () => {
  const line = { role: 'highlight' as const, label: 'Sông Ba', geometry: { type: 'LineString' as const, coordinates: [[108, 12], [108.2, 12.2]] } };
  const poly = { role: 'result' as const, geometry: { type: 'Polygon' as const, coordinates: [[[108, 12], [108.1, 12], [108.1, 12.1], [108, 12]]] } };

  it('draws lines and polygons into its own tagged layer', () => {
    const { map, added } = makeMapWithView();
    showResults(map, [line, poly], false);
    const layer = added.find((l) => l.get('id') === RESULTS_LAYER_ID)!;
    expect(layer.getSource().getFeatures()).toHaveLength(2);
  });

  it('fits the view to the drawn extent only when asked', () => {
    const { map, fit } = makeMapWithView();
    showResults(map, [line], false);
    expect(fit).not.toHaveBeenCalled();
    showResults(map, [line], true);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('clearHighlights empties the results layer too', () => {
    const { map, added } = makeMapWithView();
    showResults(map, [line], false);
    clearHighlights(map);
    const layer = added.find((l) => l.get('id') === RESULTS_LAYER_ID)!;
    expect(layer.getSource().getFeatures()).toHaveLength(0);
  });
});
