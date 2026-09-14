import { describe, it, expect, vi } from 'vitest';
import { MapModel } from './MapModel';

describe('MapModel.updateSize', () => {
  it('does nothing when the map has not been initialized', () => {
    const model = new MapModel();
    expect(() => model.updateSize()).not.toThrow();
  });

  it('delegates to the underlying OpenLayers map once initialized', () => {
    const model = new MapModel();
    const updateSize = vi.fn();
    // MapModel's `map` field is TS-private only (a plain JS property, not a
    // real `#private` field), so this test injects a fake map directly rather
    // than driving the full init() (which does live WFS/GeoJSON fetches — out
    // of scope for a unit test of this one-line delegation).
    (model as unknown as { map: { updateSize: () => void } }).map = { updateSize };
    model.updateSize();
    expect(updateSize).toHaveBeenCalledTimes(1);
  });
});
