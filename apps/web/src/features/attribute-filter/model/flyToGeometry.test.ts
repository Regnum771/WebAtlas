import { describe, it, expect, vi } from 'vitest';
import { flyToGeometry } from './flyToGeometry';

function makeMap() {
  const fit = vi.fn();
  return { map: { getView: () => ({ fit }) }, fit };
}

const lineGeom = { getExtent: () => [0, 0, 100, 50] };

describe('flyToGeometry', () => {
  it('fits the geometry extent rather than centring on a vertex', () => {
    const { map, fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flyToGeometry(map as any, lineGeom as any);
    expect(fit).toHaveBeenCalledWith([0, 0, 100, 50], expect.any(Object));
  });

  it('reserves space on the left so the feature is not hidden behind the panels', () => {
    const { map, fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flyToGeometry(map as any, lineGeom as any, { padding: [40, 40, 40, 700] });
    const opts = fit.mock.calls[0][1];
    expect(opts.padding).toEqual([40, 40, 40, 700]);
  });

  it('caps how far in a tiny geometry zooms', () => {
    const { map, fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    flyToGeometry(map as any, { getExtent: () => [10, 10, 10, 10] } as any);
    expect(fit.mock.calls[0][1].maxZoom).toBeGreaterThan(0);
  });

  it('does nothing without a map or geometry', () => {
    const { fit } = makeMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => flyToGeometry(null, lineGeom as any)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => flyToGeometry({ getView: () => ({ fit }) } as any, null)).not.toThrow();
    expect(fit).not.toHaveBeenCalled();
  });
});
