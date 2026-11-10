import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogueLayersSectionView } from './CatalogueLayersSection.view';
import type { CatalogueLayer } from '../model/catalogue.store';

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
});
