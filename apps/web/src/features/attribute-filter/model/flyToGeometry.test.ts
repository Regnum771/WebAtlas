import { describe, it, expect, vi } from 'vitest';
import { flyToGeometry } from './flyToGeometry';

// Minimal fakes: a geometry exposes getExtent(); the map exposes getView().animate.
function geom(extent: number[]) {
  return { getExtent: () => extent };
}
function fakeMap() {
  const animate = vi.fn();
  return { map: { getView: () => ({ animate }) }, animate };
}

describe('flyToGeometry', () => {
  it('animates to the extent CENTER (works for a line/polygon, not just a point)', () => {
    const { map, animate } = fakeMap();
    // A river extent [minX,minY,maxX,maxY]; center is the midpoint, not any vertex.
    flyToGeometry(map as never, geom([100, 200, 300, 400]) as never);
    expect(animate).toHaveBeenCalledTimes(1);
    const arg = animate.mock.calls[0][0];
    expect(arg.center).toEqual([200, 300]);
  });

  it('a point geometry (zero-area extent) animates to that point', () => {
    const { map, animate } = fakeMap();
    flyToGeometry(map as never, geom([500, 600, 500, 600]) as never);
    expect(animate.mock.calls[0][0].center).toEqual([500, 600]);
  });

  it('does not throw on a null map or null geometry', () => {
    expect(() => flyToGeometry(null as never, geom([0, 0, 1, 1]) as never)).not.toThrow();
    const { map, animate } = fakeMap();
    flyToGeometry(map as never, null as never);
    expect(animate).not.toHaveBeenCalled();
  });

  it('passes the given zoom through', () => {
    const { map, animate } = fakeMap();
    flyToGeometry(map as never, geom([0, 0, 10, 10]) as never, 9);
    expect(animate.mock.calls[0][0].zoom).toBe(9);
  });
});
