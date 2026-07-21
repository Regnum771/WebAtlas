import { describe, it, expect, afterEach } from 'vitest';
// jsdom does not implement ResizeObserver, but ol/Map's constructor requires it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
import { MAP_MIN_ZOOM, VIETNAM_EXTENT_4326 } from '@webatlas/shared';
import { transformExtent } from 'ol/proj';
import { MapModel } from './MapModel';

// GEOSERVER_URL / fetch aren't exercised here: MapModel.init() only constructs
// VectorSources with a `url`; OL only fetches lazily when a source is actually
// asked to render/load features, which none of these tests trigger.

// jsdom's getComputedStyle only reports border/padding widths once the
// element has explicit values (otherwise borderLeftWidth etc. are '', which
// OL's updateSize() parses as NaN and treats as "no size yet").
function makeSizedTarget(width: number, height: number): HTMLDivElement {
  const el = document.createElement('div');
  el.style.border = '0px';
  el.style.padding = '0px';
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe('MapModel — Vietnam fit on startup (Finding 4)', () => {
  let model: MapModel;

  afterEach(() => {
    model?.dispose();
    document.body.innerHTML = '';
  });

  it('fits the whole VIETNAM_EXTENT_4326 into the viewport when the target already has a size', () => {
    const el = makeSizedTarget(800, 700);
    model = new MapModel();
    model.init(el);

    const map = model.getMap()!;
    const view = map.getView();
    const zoom = view.getZoom()!;

    // The fitting zoom must be reachable given MAP_MIN_ZOOM (Finding 4b) — and
    // since the target had a real size at init(), the fit must actually have
    // happened rather than defaulting to MAP_DEFAULT_ZOOM (7), which is too close.
    expect(zoom).toBeLessThan(7);
    expect(zoom).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);

    // The fitted extent (view extent at this resolution/size) must fully contain
    // Vietnam's bbox — i.e. the country fits, it isn't clipped top/bottom.
    const vietnam3857 = transformExtent([...VIETNAM_EXTENT_4326], 'EPSG:4326', 'EPSG:3857');
    const calculated = view.calculateExtent(map.getSize());
    expect(calculated[1]).toBeLessThanOrEqual(vietnam3857[1] + 1); // south edge covered
    expect(calculated[3]).toBeGreaterThanOrEqual(vietnam3857[3] - 1); // north edge covered
  });

  it('defers the fit until the map gains a size, when constructed with zero size', () => {
    const el = makeSizedTarget(0, 0);
    model = new MapModel();
    model.init(el);

    const map = model.getMap()!;
    const view = map.getView();
    // No size yet: the pre-fit default from the View constructor is still in effect.
    expect(view.getZoom()).toBeCloseTo(7);

    // Simulate layout completing: give the target a real size and fire change:size,
    // the same event MapModel listens for.
    Object.defineProperty(el, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 700, configurable: true });
    map.updateSize();

    const zoomAfter = view.getZoom()!;
    expect(zoomAfter).toBeLessThan(7);
    expect(zoomAfter).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
  });

  it('fitVietnam() re-fits on demand (home button behaviour)', () => {
    const el = makeSizedTarget(800, 700);
    model = new MapModel();
    model.init(el);

    const map = model.getMap()!;
    const view = map.getView();
    // Pan/zoom away from the fitted view.
    view.setZoom(15);
    expect(view.getZoom()).toBe(15);

    model.fitVietnam();
    expect(view.getZoom()!).toBeLessThan(7);
    expect(view.getZoom()!).toBeGreaterThanOrEqual(MAP_MIN_ZOOM);
  });

  it('lets the view center reach the country\'s northern and southern tips at the fitted zoom (Finding 4c)', () => {
    const el = makeSizedTarget(800, 700);
    model = new MapModel();
    model.init(el);

    const map = model.getMap()!;
    const view = map.getView();
    const vietnam3857 = transformExtent([...VIETNAM_EXTENT_4326], 'EPSG:4326', 'EPSG:3857') as [number, number, number, number];
    const centerX = (vietnam3857[0] + vietnam3857[2]) / 2;

    // Without `constrainOnlyCenter: true`, OL's default extent constraint
    // clamps the CENTER so the whole viewport stays inside `extent` — the
    // allowed center range shrinks by half the viewport size on every side.
    // At a zoom that fits the whole country, half the viewport height alone
    // is a large fraction of the country's own height, so the true edges
    // (Ha Giang ~23.3N, Ca Mau ~8.6N) would be unreachable. MapModel passes
    // `constrainOnlyCenter: true`, so the center can be pushed all the way to
    // the exact bbox edge regardless of viewport size.
    view.setCenter([centerX, vietnam3857[3]]);
    expect(view.getCenter()![1]).toBeCloseTo(vietnam3857[3], 6);

    view.setCenter([centerX, vietnam3857[1]]);
    expect(view.getCenter()![1]).toBeCloseTo(vietnam3857[1], 6);
  });
});
