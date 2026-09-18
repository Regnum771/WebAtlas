import { describe, it, expect, vi } from 'vitest';
import { createCommandExecutor, type CommandDeps } from './mapCommands';
import { INITIAL_CENTER_4326, INITIAL_ZOOM } from './zoomScale';
import { fromLonLat } from 'ol/proj';

function makeDeps(
  overrides: Partial<CommandDeps> = {},
  viewOverrides: { getMinZoom?: () => number | undefined; getMaxZoom?: () => number | undefined } = {},
): CommandDeps & { animate: ReturnType<typeof vi.fn> } {
  const animate = vi.fn();
  const map = {
    getView: () => ({
      animate,
      getMinZoom: viewOverrides.getMinZoom ?? (() => undefined),
      getMaxZoom: viewOverrides.getMaxZoom ?? (() => undefined),
    }),
    addLayer: vi.fn(),
  } as unknown as CommandDeps['map'];
  return {
    map,
    animate,
    setBasemap: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
    getLayerVisible: vi.fn().mockReturnValue(false),
    layerExists: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe('createCommandExecutor', () => {
  it('zoomToFeature animates the view and reports the feature', () => {
    const deps = makeDeps();
    const run = createCommandExecutor(deps);

    const result = run({ kind: 'zoomToFeature', layerKey: 'dams', featureId: 'x1', lonLat: [108.1, 12.7] });

    expect(deps.animate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'Đã phóng to tới đối tượng đã chọn.' });
  });

  it('zoomToRegion names the province in Vietnamese', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({ kind: 'zoomToRegion', provinceCode: '66' });

    expect(deps.animate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'Đã phóng to tới Đắk Lắk.' });
  });

  it('resetView animates to the whole working region (INITIAL_CENTER_4326/INITIAL_ZOOM), not a single province', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({ kind: 'resetView' });

    expect(deps.animate).toHaveBeenCalledWith(
      expect.objectContaining({ center: fromLonLat(INITIAL_CENTER_4326), zoom: INITIAL_ZOOM })
    );
    expect(result).toEqual({ ok: true, text: 'Đã về vùng công tác.' });
  });

  it('resetView fails cleanly when the map is not ready', () => {
    const deps = makeDeps({ map: null });
    const result = createCommandExecutor(deps)({ kind: 'resetView' });
    expect(result).toEqual({ ok: false, reason: 'Bản đồ chưa sẵn sàng.' });
  });

  it('setLayerVisible only toggles when the current state differs', () => {
    const deps = makeDeps({ getLayerVisible: vi.fn().mockReturnValue(true) });
    const run = createCommandExecutor(deps);

    run({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: true });
    expect(deps.toggleLayerVisibility).not.toHaveBeenCalled();

    run({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: false });
    expect(deps.toggleLayerVisibility).toHaveBeenCalledWith('layer_dams');
  });

  it('setLayerOpacity forwards the value', () => {
    const deps = makeDeps();
    createCommandExecutor(deps)({ kind: 'setLayerOpacity', layerStateId: 'layer_rivers', opacity: 0.4 });
    expect(deps.setLayerOpacity).toHaveBeenCalledWith('layer_rivers', 0.4);
  });

  it('setLayerVisible reports failure instead of success when the layerStateId is not in layersState', () => {
    const deps = makeDeps({ layerExists: vi.fn().mockReturnValue(false) });
    const result = createCommandExecutor(deps)({ kind: 'setLayerVisible', layerStateId: 'bogus', visible: true });
    expect(result.ok).toBe(false);
    expect(deps.toggleLayerVisibility).not.toHaveBeenCalled();
  });

  it('setLayerOpacity reports failure instead of success when the layerStateId is not in layersState', () => {
    const deps = makeDeps({ layerExists: vi.fn().mockReturnValue(false) });
    const result = createCommandExecutor(deps)({ kind: 'setLayerOpacity', layerStateId: 'bogus', opacity: 0.5 });
    expect(result.ok).toBe(false);
    expect(deps.setLayerOpacity).not.toHaveBeenCalled();
  });

  it('setBasemap forwards the basemap', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({ kind: 'setBasemap', basemap: 'satellite' });
    expect(deps.setBasemap).toHaveBeenCalledWith('satellite');
    expect(result.ok).toBe(true);
  });

  it('zoomTo animates to the requested zoom', () => {
    const deps = makeDeps({}, { getMinZoom: () => 3, getMaxZoom: () => 12 });
    const result = createCommandExecutor(deps)({ kind: 'zoomTo', zoom: 8 });

    expect(deps.animate).toHaveBeenCalledWith(expect.objectContaining({ zoom: 8 }));
    expect(result).toEqual({ ok: true, text: 'Đã đổi mức thu phóng.' });
  });

  it('zoomTo clamps a request below the view minimum', () => {
    const deps = makeDeps({}, { getMinZoom: () => 3, getMaxZoom: () => 12 });
    createCommandExecutor(deps)({ kind: 'zoomTo', zoom: 1 });
    expect(deps.animate).toHaveBeenCalledWith(expect.objectContaining({ zoom: 3 }));
  });

  it('zoomTo clamps a request above the view maximum', () => {
    const deps = makeDeps({}, { getMinZoom: () => 3, getMaxZoom: () => 12 });
    createCommandExecutor(deps)({ kind: 'zoomTo', zoom: 20 });
    expect(deps.animate).toHaveBeenCalledWith(expect.objectContaining({ zoom: 12 }));
  });

  it('zoomTo fails cleanly when the map is not ready', () => {
    const deps = makeDeps({ map: null });
    const result = createCommandExecutor(deps)({ kind: 'zoomTo', zoom: 8 });
    expect(result).toEqual({ ok: false, reason: 'Bản đồ chưa sẵn sàng.' });
  });

  it('fails cleanly when the map is not ready', () => {
    const deps = makeDeps({ map: null });
    const result = createCommandExecutor(deps)({ kind: 'zoomToRegion', provinceCode: '66' });
    expect(result).toEqual({ ok: false, reason: 'Bản đồ chưa sẵn sàng.' });
  });
});

describe('createCommandExecutor — highlights', () => {
  it('highlightFeatures draws the points and reports how many', () => {
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({
      kind: 'highlightFeatures',
      points: [{ lonLat: [108.1, 12.7] }, { lonLat: [108.2, 12.8] }],
    });
    expect(result).toEqual({ ok: true, text: 'Đã đánh dấu 2 vị trí trên bản đồ.' });
  });

  it('highlightFeatures fails cleanly when the map is not ready', () => {
    const result = createCommandExecutor(makeDeps({ map: null }))({
      kind: 'highlightFeatures',
      points: [{ lonLat: [108.1, 12.7] }],
    });
    expect(result).toEqual({ ok: false, reason: 'Bản đồ chưa sẵn sàng.' });
  });

  it('clearHighlights reports success even with nothing highlighted', () => {
    const result = createCommandExecutor(makeDeps())({ kind: 'clearHighlights' });
    expect(result).toEqual({ ok: true, text: 'Đã xoá đánh dấu.' });
  });

  it('showGeometries draws results and reports the count', () => {
    const deps = makeDeps();
    (deps.map as unknown as { getSize: () => number[] }).getSize = () => [800, 600];
    const result = createCommandExecutor(deps)({
      kind: 'showGeometries',
      items: [{ role: 'highlight', geometry: { type: 'Point', coordinates: [108, 12] } }],
    });
    expect(result).toEqual({ ok: true, text: 'Đã hiển thị 1 hình trên bản đồ.' });
  });

  it('proposeFeatureEdit hands the proposal to the wizard callback', () => {
    const onProposeEdit = vi.fn();
    const deps = makeDeps({ onProposeEdit });
    const proposal = {
      kind: 'proposeFeatureEdit' as const, layerKey: 'dams' as const, featureId: 'f1',
      current: { wattage_mw: '70' }, proposed: { wattage_mw: '72' },
    };
    expect(createCommandExecutor(deps)(proposal)).toEqual({ ok: true, text: 'Đã mở biểu mẫu đề xuất cập nhật.' });
    expect(onProposeEdit).toHaveBeenCalledWith(proposal);
  });

  it('proposeFeatureEdit fails cleanly with no wizard mounted', () => {
    const result = createCommandExecutor(makeDeps())({
      kind: 'proposeFeatureEdit', layerKey: 'dams', featureId: 'f1', current: {}, proposed: { name: 'x' },
    });
    expect(result).toEqual({ ok: false, reason: 'Không mở được biểu mẫu cập nhật.' });
  });
});
