import { describe, it, expect, vi, afterEach } from 'vitest';
import { FABDEM_ATTRIBUTION } from '@webatlas/shared';
import { MapModel } from './MapModel';
import { settleZoomCorrection, zoomForScale, scaleAtZoom } from './zoomScale';
import type TileLayer from 'ol/layer/Tile';
import type XYZ from 'ol/source/XYZ';
import ScaleLine from 'ol/control/ScaleLine';
import MousePosition from 'ol/control/MousePosition';
import type Map from 'ol/Map';
import VectorTileLayer from 'ol/layer/VectorTile';
import { waterTileUrl } from './waterTiles';
import VectorTileSource from 'ol/source/VectorTile';

// jsdom has no ResizeObserver but the ol/Map constructor needs it (init() builds a
// real Map underneath) — the same workaround as DrawController.test.ts.
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

    // MapModel's `contextLayers` field is TS-private only, the same way the
    // "delegates to..." test above reaches `map` — take a REAL context source that
    // init() just attached the tileload* handlers to (see contextLoadHandlers in MapModel.ts).
    const contextLayers = (model as unknown as { contextLayers: Record<string, TileLayer<XYZ>> }).contextLayers;
    const firstSource = Object.values(contextLayers)[0].getSource()!;

    // Before dispose(): the handlers really are registered on the source.
    expect(firstSource.hasListener('tileloadstart')).toBe(true);
    expect(firstSource.hasListener('tileloadend')).toBe(true);
    expect(firstSource.hasListener('tileloaderror')).toBe(true);

    model.dispose();

    // After dispose(): no handler is left on the old source...
    expect(firstSource.hasListener('tileloadstart')).toBe(false);
    expect(firstSource.hasListener('tileloadend')).toBe(false);
    expect(firstSource.hasListener('tileloaderror')).toBe(false);

    // ...so a late load event (a request in flight at unmount) no longer reaches
    // the listener — it can no longer overwrite the dead instance's `busy`.
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

    // dispose() MUST null onLoadingChange — otherwise the dead instance still holds
    // React's old setBusy and can overwrite the new instance's state.
    expect((model as unknown as { onLoadingChange: unknown }).onLoadingChange).toBeNull();
    expect(onBusyChange).not.toHaveBeenCalled();
  });
});

describe('MapModel.setContourSettings', () => {
  it('một khoảng cố định phải giữ nguyên qua đổi mức thu phóng, và source vẫn ghi công FABDEM', () => {
    const model = new MapModel();
    const el = document.createElement('div');
    model.init(el);

    model.setContourSettings({ interval: 100, labels: false });

    const contourLayer = (model as unknown as { contourLayer: TileLayer<XYZ> }).contourLayer;
    const source = contourLayer.getSource()!;
    const url = source.getUrls()?.[0] ?? '';
    expect(url).toContain('LAYER=webatlas%3Acontours_100');
    expect(url).toContain('STYLE=webatlas:contours_plain');
    expect(source.getAttributions()?.(undefined as never)).toEqual([FABDEM_ATTRIBUTION]);

    // Change the zoom and fire moveend by hand (as OpenLayers does when the user
    // scrolls) — the fixed interval must not be overridden by the automatic one.
    const map = (model as unknown as { map: Map }).map;
    map.getView().setZoom(20);
    const moveendHandler = (model as unknown as { moveendHandler: (() => void) | null }).moveendHandler;
    moveendHandler?.();

    expect(contourLayer.getSource()).toBe(source);
  });
});

describe('water layers from vector tiles', () => {
  type Internals = { map: Map; layers: Record<string, VectorTileLayer>; riversOverviewLayer: VectorTileLayer };
  const versions = (body: { rivers: string | null; lakes: string | null }) =>
    vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, json: async () => body }));
  afterEach(() => vi.unstubAllGlobals());

  it('points rivers, the overview and lakes at their active versions after init', async () => {
    vi.stubGlobal('fetch', versions({ rivers: 'r1', lakes: 'l1' }));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    expect(m.layers.layer_rivers).toBeInstanceOf(VectorTileLayer);
    expect(m.layers.layer_lakes).toBeInstanceOf(VectorTileLayer);
    await vi.waitFor(() => expect(m.layers.layer_lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l1')]));
    expect(m.layers.layer_rivers.getSource()!.getUrls()).toEqual([waterTileUrl('rivers', 'r1')]);
    expect(m.riversOverviewLayer.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', 'r1')]);
    model.dispose();
  });

  it('refreshLayer after an edit re-reads the versions instead of refetching features', async () => {
    vi.stubGlobal('fetch', versions({ rivers: 'r1', lakes: 'l1' }));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    await vi.waitFor(() => expect(m.layers.layer_lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l1')]));
    vi.stubGlobal('fetch', versions({ rivers: 'r1', lakes: 'l2' }));
    model.refreshLayer('layer_lakes');
    await vi.waitFor(() => expect(m.layers.layer_lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l2')]));
    model.dispose();
  });

  it('keeps the water layers hidden until the versions are known, so no tile loads twice', async () => {
    let answer: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { answer = r; })));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    model.applyLayerStates([{ id: 'layer_rivers', visible: true, opacity: 1 }]);
    expect(m.riversOverviewLayer.getVisible()).toBe(false);
    answer({ ok: true, status: 200, json: async () => ({ rivers: 'r1', lakes: 'l1' }) });
    await vi.waitFor(() => expect(m.riversOverviewLayer.getVisible()).toBe(true));
    expect(m.riversOverviewLayer.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', 'r1')]);
    model.dispose();
  });

  it('applies only the latest versions answer when two requests answer out of order', async () => {
    const answers: Array<(v: unknown) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { answers.push(r); })));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    const reply = (i: number, body: { rivers: string; lakes: string }) =>
      answers[i]({ ok: true, status: 200, json: async () => body });
    // [0] start-up, [1] the refresh after an edit; the refresh answers first.
    model.refreshLayer('layer_lakes');
    expect(answers).toHaveLength(2);
    reply(1, { rivers: 'r1', lakes: 'l2' });
    await vi.waitFor(() => expect(m.layers.layer_lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l2')]));
    reply(0, { rivers: 'r1', lakes: 'l1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(m.layers.layer_lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l2')]);
    model.dispose();
  });

  it('applies an older successful answer when the newest request fails', async () => {
    const answers: Array<{ ok: (v: unknown) => void; fail: (e: unknown) => void }> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((ok, fail) => { answers.push({ ok, fail }); })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    model.refreshLayer('layer_lakes');
    expect(answers).toHaveLength(2);
    answers[1].fail(new Error('offline'));
    await new Promise((r) => setTimeout(r, 0));
    answers[0].ok({ ok: true, status: 200, json: async () => ({ rivers: 'r1', lakes: 'l1' }) });
    await vi.waitFor(() => expect(m.layers.layer_lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l1')]));
    model.dispose();
  });

  it('draws the wards from API tiles at their token, and never requests wards-region.geojson', async () => {
    const fetchMock = versions({ rivers: 'r1', lakes: 'l1', wards: 'w1' } as never);
    vi.stubGlobal('fetch', fetchMock);
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    const wards = m.layers.layer_wards_2026;
    expect(wards).toBeInstanceOf(VectorTileLayer);
    expect(wards.getSource()).toBeInstanceOf(VectorTileSource);
    await vi.waitFor(() => expect(wards.getSource()!.getUrls()).toEqual([waterTileUrl('wards', 'w1')]));
    // Hidden below WARDS_MIN_ZOOM, shown from it, once the versions are known.
    await vi.waitFor(() => expect((model as unknown as { waterVersionsSettled: boolean }).waterVersionsSettled).toBe(true));
    const states = [{ id: 'layer_wards_2026', visible: true, opacity: 1 }];
    m.map.getView().setZoom(9.9);
    model.applyLayerStates(states);
    expect(wards.getVisible()).toBe(false);
    m.map.getView().setZoom(11);
    model.applyLayerStates(states);
    expect(wards.getVisible()).toBe(true);
    const requested = [
      ...fetchMock.mock.calls.map((c) => String(c[0])),
      ...xhrOpen.mock.calls.map((c) => String(c[1])),
    ];
    expect(requested.some((u) => u.includes('wards-region.geojson'))).toBe(false);
    model.dispose();
    xhrOpen.mockRestore();
  });

  it('shows the water layers after the timeout when the start-up request hangs', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      const model = new MapModel();
      model.init(document.createElement('div'));
      const m = model as unknown as Internals;
      model.applyLayerStates([{ id: 'layer_rivers', visible: true, opacity: 1 }]);
      vi.advanceTimersByTime(MapModel.WATER_VERSIONS_TIMEOUT_MS - 1);
      expect(m.riversOverviewLayer.getVisible()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(m.riversOverviewLayer.getVisible()).toBe(true);
      model.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refresh that answers settles the start-up wait even if the start-up request hangs', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(() => (call++ === 0
      ? new Promise(() => {})
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ rivers: 'r2', lakes: 'l2' }) }))));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    model.applyLayerStates([{ id: 'layer_rivers', visible: true, opacity: 1 }]);
    model.refreshLayer('layer_rivers');
    await vi.waitFor(() => expect(m.riversOverviewLayer.getVisible()).toBe(true));
    expect(m.riversOverviewLayer.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', 'r2')]);
    model.dispose();
  });

  it('a failed versions fetch still shows the water layers, on unversioned URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    model.applyLayerStates([{ id: 'layer_rivers', visible: true, opacity: 1 }]);
    await vi.waitFor(() => expect(m.riversOverviewLayer.getVisible()).toBe(true));
    expect(m.riversOverviewLayer.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', null)]);
    model.dispose();
  });

  it('hands rivers over from the overview to the full layer at 8.5, never drawing both', async () => {
    vi.stubGlobal('fetch', versions({ rivers: 'r1', lakes: 'l1' }));
    const model = new MapModel();
    model.init(document.createElement('div'));
    const m = model as unknown as Internals;
    await vi.waitFor(() => expect(m.riversOverviewLayer.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', 'r1')]));
    await vi.waitFor(() => expect((model as unknown as { waterVersionsSettled: boolean }).waterVersionsSettled).toBe(true));
    const states = [
      { id: 'layer_rivers', visible: true, opacity: 1 },
      { id: 'layer_lakes', visible: true, opacity: 1 },
    ];
    m.map.getView().setZoom(8.4);
    model.applyLayerStates(states);
    expect(m.riversOverviewLayer.getVisible()).toBe(true);
    expect(m.layers.layer_rivers.getVisible()).toBe(false);
    expect(m.layers.layer_lakes.getVisible()).toBe(false);
    m.map.getView().setZoom(8.5);
    model.applyLayerStates(states);
    expect(m.riversOverviewLayer.getVisible()).toBe(false);
    expect(m.layers.layer_rivers.getVisible()).toBe(true);
    expect(m.layers.layer_lakes.getVisible()).toBe(true);
    model.dispose();
  });
});

describe('map controls wiring', () => {
  it('includes ScaleLine and MousePosition controls after init()', () => {
    const model = new MapModel();
    const el = document.createElement('div');
    model.init(el);

    const map = (model as unknown as { map: Map }).map;
    const controls = map.getControls().getArray();

    // Check that ScaleLine control is present — prevents revert to empty controls
    const hasScaleLine = controls.some((control) => control instanceof ScaleLine);
    expect(hasScaleLine).toBe(true);

    // Check that MousePosition control is present
    const hasMousePosition = controls.some((control) => control instanceof MousePosition);
    expect(hasMousePosition).toBe(true);
  });
});
