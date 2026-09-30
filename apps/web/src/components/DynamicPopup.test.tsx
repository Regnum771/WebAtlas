import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DynamicPopup from './DynamicPopup';

const h = vi.hoisted(() => ({
  handler: null as null | ((e: unknown) => void),
  info: [] as Array<{ resolve: (v: unknown) => void }>,
  members: [] as Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>,
}));

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
      cb({ getProperties: () => ({ code: '66', name: 'Đắk Lắk', fullName: 'Tỉnh Đắk Lắk' }), getId: () => 'p.66' },
        { get: () => 'layer_provinces_2026' });
    },
    getSize: () => [100, 100],
    getView: () => ({ calculateExtent: () => [0, 0, 1, 1], getZoom: () => 12, animate: () => {} }),
    getPixelFromCoordinate: () => [10, 10],
    getTargetElement: () => document.createElement('div'),
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
