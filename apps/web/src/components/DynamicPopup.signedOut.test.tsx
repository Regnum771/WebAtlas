import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DynamicPopup from './DynamicPopup';

// The real useUnitTree runs here (only its fetch is stubbed): everyone reads, so a signed-out
// visitor gets unit names on feature cards, not raw codes.
const h = vi.hoisted(() => ({ handler: null as null | ((e: unknown) => void) }));

vi.mock('../entities/session/model/session.store', () => ({
  useSession: () => ({ status: 'anonymous', currentUser: null }),
}));
vi.mock('../entities/session/api/unitTree.api', async () => {
  const shared = await import('@webatlas/shared');
  return {
    fetchUnitTree: () => Promise.resolve(shared.buildUnitTree([
      { code: 'VN', level: 'country', parent: null, name: 'Việt Nam' },
      { code: '48', level: 'province', parent: 'VN', name: 'Đà Nẵng' },
    ])),
  };
});
vi.mock('../features/map/model/drawingState', () => ({ isDrawing: () => false, drawingJustEnded: () => false }));
vi.mock('../features/map/model/mapEditing', () => ({ useMapEditing: () => ({ editing: false }) }));
vi.mock('../features/roi/model/roi.store', () => ({ setRoi: vi.fn() }));
vi.mock('../features/map/model/basemapInfo', () => ({ fetchBasemapInfo: () => new Promise(() => {}) }));
vi.mock('../features/roi/api/roi.api', () => ({ fetchEntitiesByMember: () => new Promise(() => {}) }));
vi.mock('../app/providers/MapProvider', () => {
  const map = {
    on: (ev: string, fn: (e: unknown) => void) => { if (ev === 'singleclick') h.handler = fn; },
    un: () => {},
    forEachFeatureAtPixel: (_px: unknown, cb: (f: unknown, l: unknown) => unknown) => {
      cb({
        getProperties: () => ({ layerKey: 'dams', id: 'd1', geographicalName: 'Hồ A', ratedPower: 10, managingAuthority: '48' }),
        getId: () => undefined,
      }, { get: () => 'layer_dams' });
    },
    getSize: () => [100, 100],
    getView: () => ({ calculateExtent: () => [0, 0, 1, 1], getZoom: () => 12, animate: () => {} }),
    getPixelFromCoordinate: () => [10, 10],
    getTargetElement: () => document.createElement('div'),
    hasFeatureAtPixel: () => false,
  };
  return { useMapContext: () => ({ map, reservoirFilter: 'all', setReservoirFilter: () => {} }) };
});

describe('DynamicPopup for a signed-out visitor', () => {
  it('names the managing unit instead of showing its code', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DynamicPopup />
      </QueryClientProvider>,
    );
    await act(async () => { h.handler!({ pixel: [1, 1], coordinate: [1, 1] }); });
    expect(screen.getByText('Đơn vị chủ quản:')).toBeInTheDocument();
    expect(await screen.findByText('Đà Nẵng')).toBeInTheDocument();
    expect(screen.queryByText('48')).not.toBeInTheDocument();
  });
});
