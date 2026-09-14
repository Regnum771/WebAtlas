import { describe, it, expect, vi } from 'vitest';
import { MapModel } from './MapModel';
import { settleZoomCorrection, zoomForScale, scaleAtZoom } from './zoomScale';
import type TileLayer from 'ol/layer/Tile';
import type XYZ from 'ol/source/XYZ';

// jsdom không có ResizeObserver nhưng constructor của ol/Map cần nó (init() dựng
// Map thật bên dưới) — cùng cách khắc phục như DrawController.test.ts.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

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
    expect(scaleAtZoom(zoom)).toBeCloseTo(1_250_000, 0);

    // The correction fired another moveend. This pass must do nothing.
    onMoveEnd();
    expect(setZoom).toHaveBeenCalledTimes(1);
  });

  it('leaves a pan alone — same scale in, no correction out', () => {
    const settled = zoomForScale(1_000_000);
    expect(settleZoomCorrection(settled)).toBeNull();
  });
});

describe('context-layer load-tracking teardown', () => {
  it('gỡ hết tay cầm tileload* khỏi source khi dispose(), nên sự kiện tải trễ không còn chạm tới listener', () => {
    const model = new MapModel();
    const el = document.createElement('div');
    model.init(el);

    const onBusyChange = vi.fn();
    model.setLoadingListener(onBusyChange);

    // MapModel's `contextLayers` field is TS-private only, giống cách test
    // "delegates to..." ở trên truy cập `map` — lấy một source ngữ cảnh THẬT mà
    // init() vừa gắn tay cầm tileload* lên (xem MapModel.ts quanh dòng 161).
    const contextLayers = (model as unknown as { contextLayers: Record<string, TileLayer<XYZ>> }).contextLayers;
    const firstSource = Object.values(contextLayers)[0].getSource()!;

    // Trước dispose(): tay cầm đã thật sự đăng ký trên source.
    expect(firstSource.hasListener('tileloadstart')).toBe(true);
    expect(firstSource.hasListener('tileloadend')).toBe(true);
    expect(firstSource.hasListener('tileloaderror')).toBe(true);

    model.dispose();

    // Sau dispose(): không còn tay cầm nào sót lại trên source cũ...
    expect(firstSource.hasListener('tileloadstart')).toBe(false);
    expect(firstSource.hasListener('tileloadend')).toBe(false);
    expect(firstSource.hasListener('tileloaderror')).toBe(false);

    // ...nên một sự kiện tải bắn trễ (request đang bay lúc unmount) không còn
    // chạm tới listener — tức không còn ghi đè `busy` của instance đã chết.
    firstSource.dispatchEvent({ type: 'tileloadstart' } as never);
    expect(onBusyChange).not.toHaveBeenCalled();
  });

  it('dispose() gỡ luôn onLoadingChange, nên listener cũ không còn nhận báo bận sau đó', () => {
    const model = new MapModel();
    const el = document.createElement('div');
    model.init(el);

    const onBusyChange = vi.fn();
    model.setLoadingListener(onBusyChange);
    model.dispose();

    // dispose() PHẢI null hoá onLoadingChange — nếu không, instance đã chết vẫn
    // giữ tham chiếu tới setBusy cũ của React và có thể ghi đè state của instance mới.
    expect((model as unknown as { onLoadingChange: unknown }).onLoadingChange).toBeNull();
    expect(onBusyChange).not.toHaveBeenCalled();
  });
});
