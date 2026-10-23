import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DynamicPopup from './DynamicPopup';

const h = vi.hoisted(() => ({
  handler: null as null | ((e: unknown) => void),
  info: [] as Array<{ resolve: (v: unknown) => void }>,
  members: [] as Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>,
  target: null as null | HTMLElement,
  overlayOnTop: false,
  labelOnTop: false,
  thematic: null as null | Record<string, unknown>,
  personalOnTop: false,
}));

vi.mock('../entities/session/model/useUnitTree', async () => {
  const shared = await import('@webatlas/shared');
  const tree = shared.buildUnitTree([
    { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
    { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
  ]);
  return { useUnitTree: () => tree };
});
vi.mock('../features/map/model/drawingState', () => ({ isDrawing: () => false, drawingJustEnded: () => false }));
vi.mock('../features/map/model/mapEditing', () => ({ useMapEditing: () => ({ editing: false }) }));
vi.mock('../features/roi/model/roi.store', () => ({ setRoi: vi.fn() }));
vi.mock('../features/map/model/basemapInfo', () => ({
  fetchBasemapInfo: () => new Promise((resolve) => { h.info.push({ resolve }); }),
}));
vi.mock('../features/roi/api/roi.api', () => ({
  fetchEntitiesByMember: () => new Promise((resolve, reject) => { h.members.push({ resolve, reject }); }),
}));
vi.mock('../app/providers/MapProvider', () => {
  const map = {
    on: (ev: string, fn: (e: unknown) => void) => { if (ev === 'singleclick') h.handler = fn; },
    un: () => {},
    forEachFeatureAtPixel: (_px: unknown, cb: (f: unknown, l: unknown) => unknown) => {
      // A feature of a personal map's layer (an edit copy of dams: database column names, no layerKey).
      if (h.personalOnTop) {
        cb({ getProperties: () => ({ external_id: '7', name: 'Đập của tôi' }), getId: () => 'r7' },
          { get: (k: string) => (k === 'personal' ? true : k === 'id' ? 'ws:l1' : undefined) });
      }
      if (h.thematic) cb({ getProperties: () => h.thematic, getId: () => undefined }, { get: () => 'layer_dams' });
      if (h.overlayOnTop) cb({ getProperties: () => ({ geometry: {}, label: 'Vùng phân tích' }), getId: () => undefined }, { get: () => 'layer_roi' });
      // A province tile's label point carries only code and name; the polygon has the full attributes.
      if (h.labelOnTop) cb({ getProperties: () => ({ layer: 'province_labels', code: '66', name: 'Đắk Lắk' }), getId: () => undefined }, { get: () => 'layer_provinces_2026' });
      cb({ getProperties: () => ({ layer: 'provinces', code: '66', name: 'Đắk Lắk', fullName: 'Tỉnh Đắk Lắk' }), getId: () => undefined },
        { get: () => 'layer_provinces_2026' });
    },
    getSize: () => [100, 100],
    getView: () => ({ calculateExtent: () => [0, 0, 1, 1], getZoom: () => 12, animate: () => {} }),
    getPixelFromCoordinate: () => [10, 10],
    getTargetElement: () => (h.target ??= document.createElement('div')),
    hasFeatureAtPixel: () => false,
  };
  return { useMapContext: () => ({ map, reservoirFilter: 'all', setReservoirFilter: () => {} }) };
});

const click = (n: number) => act(async () => { h.handler!({ pixel: [n, n], coordinate: [n, n] }); });
const found = (name: string, osmId: string) => ({ name, osmId, table: 'roads_region', fclass: 'secondary' });

describe('DynamicPopup ROI candidates vs. stale lookups', () => {
  beforeEach(() => { h.handler = null; h.info.length = 0; h.members.length = 0; });

  it('ignores the results of an older click', async () => {
    render(<DynamicPopup />);
    await click(1);
    await click(2);
    // B answers first, A answers last.
    await act(async () => { h.info[1].resolve(found('Đường B', '2')); });
    await act(async () => { h.members[0].resolve([{ entityId: 'roads:b:0', name: 'Tuyến B', ref: null }]); });
    await act(async () => { h.info[0].resolve(found('Đường A', '1')); });
    expect(h.members).toHaveLength(1); // A never asks for its entities
    expect(screen.getByText('Đường B')).toBeInTheDocument();
    expect(screen.queryByText('Đường A')).not.toBeInTheDocument();
    expect(screen.getByText('Tuyến B')).toBeInTheDocument();
  });

  it('ignores A\'s member lookup landing after B opened', async () => {
    render(<DynamicPopup />);
    await click(1);
    await act(async () => { h.info[0].resolve(found('Đường A', '1')); });
    await click(2);
    await act(async () => { h.info[1].resolve(found('Đường B', '2')); });
    await act(async () => { h.members[1].resolve([{ entityId: 'roads:b:0', name: 'Tuyến B', ref: null }]); });
    await act(async () => { h.members[0].resolve([{ entityId: 'roads:a:0', name: 'Tuyến A', ref: null }]); });
    expect(screen.getByText('Tuyến B')).toBeInTheDocument();
    expect(screen.queryByText('Tuyến A')).not.toBeInTheDocument();
  });

  it('keeps the popup when the member lookup fails', async () => {
    render(<DynamicPopup />);
    await click(1);
    await act(async () => { h.info[0].resolve(found('Đường A', '1')); });
    await act(async () => { h.members[0].reject(new Error('down')); });
    expect(screen.getByText('Đường A')).toBeInTheDocument();
    expect(screen.getByText('Tỉnh Đắk Lắk')).toBeInTheDocument(); // base candidates stay
    expect(screen.queryByText('Tuyến A')).not.toBeInTheDocument();
  });
});

describe('DynamicPopup placement', () => {
  beforeEach(() => { h.handler = null; h.info.length = 0; h.members.length = 0; h.target = null; });

  // The map is docked right of the rail and the open flyout (0a5f166), but the popup is
  // positioned in the full-window app container: a map pixel alone put it 368 px left of
  // the click, behind the layers panel.
  it('sits beside the click when the map does not start at the window edge', async () => {
    h.target = document.createElement('div');
    h.target.getBoundingClientRect = () => ({ left: 368, top: 0, right: 1440, bottom: 900, width: 1072, height: 900, x: 368, y: 0, toJSON: () => ({}) });
    const { container } = render(<DynamicPopup />);
    await click(1);
    const popup = container.querySelector('.dynamic-popup') as HTMLElement;
    expect(popup.style.left).toBe(`${368 + 10 + 15}px`); // getPixelFromCoordinate → [10, 10]
  });
});

describe('DynamicPopup under an ROI overlay', () => {
  beforeEach(() => { h.handler = null; h.info.length = 0; h.members.length = 0; h.overlayOnTop = true; });
  it('still shows the province underneath a click that hits the ROI layer first', async () => {
    const { container } = render(<DynamicPopup />);
    await click(1);
    h.overlayOnTop = false;
    expect(screen.getByText('Tỉnh Đắk Lắk')).toBeInTheDocument(); // candidate from the province layer
    expect(container.textContent).not.toContain('Đối tượng không tên');
  });
});

describe('DynamicPopup on a province label point', () => {
  beforeEach(() => { h.handler = null; h.info.length = 0; h.members.length = 0; h.overlayOnTop = false; h.labelOnTop = true; });
  it('takes the province from the polygon, not from the label point drawn over it', async () => {
    render(<DynamicPopup />);
    await click(1);
    h.labelOnTop = false;
    // The label point has no fullName: read from it, the candidate would be the bare "Đắk Lắk".
    expect(screen.getByText('Tỉnh Đắk Lắk')).toBeInTheDocument();
  });
});

describe('DynamicPopup managing unit', () => {
  beforeEach(() => { h.handler = null; h.thematic = null; });

  it('the feature card shows the managing unit name', async () => {
    h.thematic = { layerKey: 'dams', id: 'd1', geographicalName: 'Hồ A', ratedPower: 10, managingAuthority: '48' };
    render(<DynamicPopup />);
    await click(1);
    expect(screen.getByText('Đơn vị chủ quản:')).toBeInTheDocument();
    expect(screen.getByText('Đà Nẵng')).toBeInTheDocument();
  });

  it('falls back to the code when the unit is not in the tree', async () => {
    h.thematic = { layerKey: 'dams', id: 'd1', geographicalName: 'Hồ A', ratedPower: 10, managingAuthority: '99999' };
    render(<DynamicPopup />);
    await click(1);
    expect(screen.getByText('99999')).toBeInTheDocument();
  });

  it('shows no row when the feature has no unit', async () => {
    h.thematic = { layerKey: 'dams', id: 'd1', geographicalName: 'Hồ A', ratedPower: 10 };
    render(<DynamicPopup />);
    await click(1);
    expect(screen.queryByText('Đơn vị chủ quản:')).not.toBeInTheDocument();
  });
});

describe('DynamicPopup over a personal layer', () => {
  beforeEach(() => { h.handler = null; h.info.length = 0; h.members.length = 0; h.thematic = null; h.personalOnTop = true; });
  it('a click on a personal layer opens no official popup and selects nothing', async () => {
    const { container } = render(<DynamicPopup />);
    await click(1);
    h.personalOnTop = false;
    // The personal feature card answers this click; the official popup stays shut and asks
    // GeoServer nothing.
    expect(container.querySelector('.dynamic-popup')).toBeNull();
    expect(h.info).toHaveLength(0);
  });
});
