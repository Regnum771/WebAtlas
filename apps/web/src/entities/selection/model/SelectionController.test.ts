import { describe, it, expect, vi } from 'vitest';
import { SelectionController } from './SelectionController';

function makeFeature(id: string, props: Record<string, unknown> = {}) {
  return {
    getId: () => id,
    getGeometryName: () => 'geometry',
    getProperties: () => ({ geometry: { fake: true }, ...props }),
  };
}

function makeMap(featuresByStateId: Record<string, ReturnType<typeof makeFeature>[]>) {
  const interactions: unknown[] = [];
  const layers = Object.entries(featuresByStateId).map(([stateId, feats]) => ({
    get: (k: string) => (k === 'id' ? stateId : undefined),
    getSource: () => ({ getFeatures: () => feats }),
  }));
  return {
    interactions,
    addInteraction: (i: unknown) => interactions.push(i),
    removeInteraction: (i: unknown) => {
      const idx = interactions.indexOf(i);
      if (idx >= 0) interactions.splice(idx, 1);
    },
    getLayers: () => ({ getArray: () => layers }),
  };
}

const KEYS = { 'dams-layer': 'dams', 'rivers-layer': 'rivers' } as const;

describe('SelectionController', () => {
  it('selects a feature by id and reports it via the change callback', () => {
    const dam = makeFeature('dams.a1', { geographicalName: 'Hoa Binh' });
    const map = makeMap({ 'dams-layer': [dam] });
    const onChange = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(onChange);

    const sel = c.selectById('dams', 'a1');

    expect(sel?.featureId).toBe('a1');
    expect(sel?.layerKey).toBe('dams');
    expect(sel?.isoProps.geographicalName).toBe('Hoa Binh');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ featureId: 'a1' }));
    expect(c.getSelected()?.featureId).toBe('a1');
  });

  it('omits the geometry property from isoProps', () => {
    const dam = makeFeature('dams.a1', { geographicalName: 'Hoa Binh' });
    const map = makeMap({ 'dams-layer': [dam] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(vi.fn());

    const sel = c.selectById('dams', 'a1');

    expect(sel?.isoProps).not.toHaveProperty('geometry');
  });

  it('returns null when the feature id is not present in the layer', () => {
    const map = makeMap({ 'dams-layer': [makeFeature('dams.a1')] });
    const onChange = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(onChange);

    expect(c.selectById('dams', 'nope')).toBeNull();
    expect(c.getSelected()).toBeNull();
  });

  it('clear() drops the selection and notifies with null', () => {
    const map = makeMap({ 'dams-layer': [makeFeature('dams.a1')] });
    const onChange = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });
    c.activate(onChange);
    c.selectById('dams', 'a1');
    onChange.mockClear();

    c.clear();

    expect(c.getSelected()).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('adds exactly one interaction on activate and removes it on deactivate', () => {
    const map = makeMap({ 'dams-layer': [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });

    c.activate(vi.fn());
    expect(map.interactions).toHaveLength(1);

    c.deactivate();
    expect(map.interactions).toHaveLength(0);
  });

  it('activate() twice does not stack interactions', () => {
    const map = makeMap({ 'dams-layer': [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = new SelectionController(map as any, { ...KEYS });

    c.activate(vi.fn());
    c.activate(vi.fn());

    expect(map.interactions).toHaveLength(1);
  });
});
