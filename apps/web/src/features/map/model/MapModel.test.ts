import { describe, it, expect, vi } from 'vitest';
import { MapModel } from './MapModel';
import { settleZoomCorrection, zoomForScale, scaleAtZoom } from './zoomScale';

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

describe('settle-snap wiring', () => {
  it('applies the correction without animating, then leaves the view alone', () => {
    // A fake view standing in for ol/View: enough surface for the handler.
    let zoom = zoomForScale(1_247_331);
    const setZoom = vi.fn((z: number) => {
      zoom = z;
    });
    const view = { getZoom: () => zoom, setZoom };

    // The handler MapModel registers on moveend, in isolation.
    const onMoveEnd = () => {
      const current = view.getZoom();
      if (current === undefined) return;
      const corrected = settleZoomCorrection(current);
      if (corrected !== null) view.setZoom(corrected);
    };

    onMoveEnd();
    expect(setZoom).toHaveBeenCalledTimes(1);
    expect(scaleAtZoom(zoom)).toBeCloseTo(1_247_000, 0);

    // The correction fired another moveend. This pass must do nothing.
    onMoveEnd();
    expect(setZoom).toHaveBeenCalledTimes(1);
  });

  it('leaves a pan alone — same scale in, no correction out', () => {
    const settled = zoomForScale(1_000_000);
    expect(settleZoomCorrection(settled)).toBeNull();
  });
});
