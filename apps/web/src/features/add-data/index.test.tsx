import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ ctx: { map: { fake: 'map' } }, addWmsOverlay: vi.fn(), search: vi.fn() }));
vi.mock('../../app/providers/MapProvider', () => ({ useMapContext: () => h.ctx }));
vi.mock('../map/model/wmsOverlay', () => ({ addWmsOverlay: h.addWmsOverlay }));
vi.mock('../catalogue/api/catalogue.api', async (orig) => ({
  ...(await orig<typeof import('../catalogue/api/catalogue.api')>()),
  searchCatalogue: h.search,
}));
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => ({ status: 'anonymous' }) }));

import AddData from './index';
import { getToasts, resetToasts } from '../../shared/ui/toast.store';

const toasts = () => getToasts().map(({ tone, title, body }) => ({ tone, title, body }));

async function openWmsTab() {
  await userEvent.click(screen.getByRole('tab', { name: 'WMS khác' }));
}

async function addLayer() {
  render(<AddData />);
  await openWmsTab();
  await userEvent.type(screen.getByLabelText('Địa chỉ dịch vụ WMS'), 'https://example.com/wms');
  await userEvent.type(screen.getByLabelText('Tên lớp'), 'ws:rivers');
  await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ' }));
}

describe('AddData', () => {
  beforeEach(() => {
    h.addWmsOverlay.mockReset(); resetToasts();
    h.search.mockReset(); h.search.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  });
  afterEach(() => { resetToasts(); vi.restoreAllMocks(); });

  it('puts the layer on the map and says so in a popup', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await addLayer();
    expect(h.addWmsOverlay).toHaveBeenCalledTimes(1);
    expect(h.addWmsOverlay).toHaveBeenCalledWith(h.ctx.map, { url: 'https://example.com/wms', layerName: 'ws:rivers' }, expect.any(Function));
    expect(toasts()).toEqual([{ tone: 'success', title: 'Đã thêm lớp ws:rivers', body: undefined }]);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a layer whose first tile fails is reported as not added', async () => {
    await addLayer();
    const onError = h.addWmsOverlay.mock.calls[0][2] as () => void;
    act(() => onError());
    expect(toasts()).toEqual([
      { tone: 'error', title: 'Không thêm được lớp ws:rivers', body: 'Kiểm tra địa chỉ và tên lớp.' },
    ]);
  });

  it('a refused form touches neither the map nor the popups', async () => {
    render(<AddData />);
    await openWmsTab();
    await userEvent.type(screen.getByLabelText('Địa chỉ dịch vụ WMS'), 'example.com/wms');
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ' }));
    expect(h.addWmsOverlay).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  it('opens on the catalogue tab', async () => {
    render(<AddData />);
    expect(screen.getByRole('tab', { name: 'Từ Danh mục', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('Không có dữ liệu phù hợp.')).toBeInTheDocument();
  });

  it('a catalogue that cannot be reached is reported and the WMS tab still works', async () => {
    h.search.mockRejectedValue(new Error('down'));
    await addLayer();
    expect(h.addWmsOverlay).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Từ Danh mục' }));
    expect(await screen.findByText('Không kết nối được Danh mục.')).toBeInTheDocument();
  });
});
