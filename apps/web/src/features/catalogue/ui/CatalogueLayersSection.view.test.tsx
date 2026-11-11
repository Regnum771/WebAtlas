import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../../shared/api/apiClient';
import userEvent from '@testing-library/user-event';
import { CatalogueLayersSectionView, type SaveToMapProps } from './CatalogueLayersSection.view';
import { addCatalogueLayer, getCatalogue, resetCatalogue, type CatalogueLayer } from '../model/catalogue.store';

const legend = vi.hoisted(() => vi.fn());
vi.mock('../api/catalogue.api', () => ({ fetchCatalogueLegend: legend }));

const layer = (id: string, over: Partial<CatalogueLayer> = {}): CatalogueLayer => ({
  item: {
    id, kind: 'vector', title: `Lớp ${id}`, abstract: '', managingUnit: null, isPublished: true, mine: false,
    variable: null, unit: null, timeSteps: null, bbox4326: null, layerName: `geonode:${id}`,
  },
  visible: true, opacity: 1, status: 'ok', ...over,
});

describe('CatalogueLayersSectionView', () => {
  it('renders nothing without layers', () => {
    const { container } = render(<CatalogueLayersSectionView layers={[]} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a gone layer shows the no-access text and can be removed', async () => {
    const onRemove = vi.fn();
    render(<CatalogueLayersSectionView layers={[layer('a', { status: 'gone' })]} onChange={vi.fn()} onRemove={onRemove} />);
    expect(screen.getByText('Không có quyền xem hoặc đã bị xoá')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gỡ Lớp a' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('toggles visibility', async () => {
    const onChange = vi.fn();
    render(<CatalogueLayersSectionView layers={[layer('a')]} onChange={onChange} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Lớp a' }));
    expect(onChange).toHaveBeenCalledWith('a', { visible: false });
  });

  describe('saving into a personal map', () => {
    const save = (over: Partial<SaveToMapProps> = {}): SaveToMapProps => ({
      targets: [{ id: 'm1', title: 'Bản của tôi' }, { id: 'm2', title: 'Lũ 2025' }],
      open: null, target: 'm1', busy: false, error: null, job: null, done: null,
      start: vi.fn(), close: vi.fn(), setTarget: vi.fn(), submit: vi.fn(), ...over,
    });
    const series = layer('t', { item: { ...layer('t').item, kind: 'timeseries', title: 'Mưa giờ' } });

    it('no save buttons without a session', () => {
      render(<CatalogueLayersSectionView layers={[layer('a')]} onChange={vi.fn()} onRemove={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Lưu vào bản đồ của tôi' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sao vào Bản của tôi' })).toBeNull();
    });

    it('a vector or raster row can be linked or copied; a time series only linked', async () => {
      const s = save();
      const { unmount } = render(<CatalogueLayersSectionView layers={[layer('a')]} onChange={vi.fn()} onRemove={vi.fn()} save={s} />);
      await userEvent.click(screen.getByRole('button', { name: 'Lưu vào bản đồ của tôi' }));
      expect(s.start).toHaveBeenCalledWith('a', 'link');
      await userEvent.click(screen.getByRole('button', { name: 'Sao vào Bản của tôi' }));
      expect(s.start).toHaveBeenCalledWith('a', 'copy');
      unmount();
      render(<CatalogueLayersSectionView layers={[series]} onChange={vi.fn()} onRemove={vi.fn()} save={save()} />);
      expect(screen.getByRole('button', { name: 'Lưu vào bản đồ của tôi' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sao vào Bản của tôi' })).toBeNull();
    });

    it('the open row picks one of the own maps and saves to it', async () => {
      const s = save({ open: { itemId: 'a', mode: 'link' } });
      render(<CatalogueLayersSectionView layers={[layer('a')]} onChange={vi.fn()} onRemove={vi.fn()} save={s} />);
      const select = screen.getByRole('combobox', { name: 'Bản đồ' });
      expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Bản của tôi', 'Lũ 2025']);
      await userEvent.selectOptions(select, 'm2');
      expect(s.setTarget).toHaveBeenCalledWith('m2');
      await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
      expect(s.submit).toHaveBeenCalledWith(layer('a').item);
    });

    it('without an own map it says so and cannot save', () => {
      render(
        <CatalogueLayersSectionView
          layers={[layer('a')]} onChange={vi.fn()} onRemove={vi.fn()}
          save={save({ targets: [], target: '', open: { itemId: 'a', mode: 'copy' } })}
        />,
      );
      expect(screen.getByText(/Chưa có bản đồ nào trong Bản của tôi/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sao' })).toBeDisabled();
    });

    it('a copy shows its job progress, then the API error verbatim', () => {
      const job = {
        id: 'j1', kind: 'import' as const, status: 'running' as const, mapId: 'm1', progress: 40,
        steps: [{ key: 'read', label: 'Đọc tệp', status: 'running' as const }], result: null, error: null,
        createdAt: '', finishedAt: null,
      };
      const { rerender } = render(
        <CatalogueLayersSectionView layers={[layer('a')]} onChange={vi.fn()} onRemove={vi.fn()} save={save({ open: { itemId: 'a', mode: 'copy' }, job, busy: true })} />,
      );
      expect(screen.getByRole('progressbar', { name: 'Tiến độ' })).toHaveAttribute('value', '40');
      expect(screen.getByText('Đọc tệp')).toBeInTheDocument();
      rerender(
        <CatalogueLayersSectionView layers={[layer('a')]} onChange={vi.fn()} onRemove={vi.fn()} save={save({ open: { itemId: 'a', mode: 'copy' }, error: 'Mục này chỉ thêm được dạng liên kết.' })} />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Mục này chỉ thêm được dạng liên kết.');
    });
  });

  it('a legend that answers 404 marks the layer gone', async () => {
    resetCatalogue();
    const l = layer('a');
    addCatalogueLayer(l.item);
    legend.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    render(<CatalogueLayersSectionView layers={[l]} onChange={vi.fn()} onRemove={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chú giải' }));
    await waitFor(() => expect(getCatalogue()[0].status).toBe('gone'));
  });
});
