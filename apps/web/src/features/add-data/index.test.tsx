import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ ctx: { map: { fake: 'map' } }, addWmsOverlay: vi.fn() }));
vi.mock('../../app/providers/MapProvider', () => ({ useMapContext: () => h.ctx }));
vi.mock('../map/model/wmsOverlay', () => ({ addWmsOverlay: h.addWmsOverlay }));

import AddData from './index';
import { getToasts, resetToasts } from '../../shared/ui/toast.store';

const toasts = () => getToasts().map(({ tone, title, body }) => ({ tone, title, body }));

async function addLayer() {
  render(<AddData />);
  await userEvent.type(screen.getByLabelText('Địa chỉ dịch vụ WMS'), 'https://example.com/wms');
  await userEvent.type(screen.getByLabelText('Tên lớp'), 'ws:rivers');
  await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ' }));
}

describe('AddData', () => {
  beforeEach(() => { h.addWmsOverlay.mockReset(); resetToasts(); });
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
    await userEvent.type(screen.getByLabelText('Địa chỉ dịch vụ WMS'), 'example.com/wms');
    await userEvent.click(screen.getByRole('button', { name: 'Thêm vào bản đồ' }));
    expect(h.addWmsOverlay).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});
