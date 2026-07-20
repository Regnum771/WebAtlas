import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let vm: Record<string, unknown>;
vi.mock('./model/useFilterPresenter', () => ({ useFilterPresenter: () => vm }));
vi.mock('../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ toggleLayerVisibility: vi.fn() }),
}));

import AttributeFilter from './index';

beforeEach(() => {
  vm = {
    isOpen: false, layerKey: null, fields: [], conditions: [], results: [],
    count: 0, activeCount: 0, layerLoaded: false,
    setLayer: vi.fn(), addCondition: vi.fn(), updateCondition: vi.fn(),
    removeCondition: vi.fn(), clear: vi.fn(), open: vi.fn(), close: vi.fn(),
    flyTo: vi.fn(),
  };
});

describe('AttributeFilter', () => {
  it('renders the funnel button, panel hidden when closed', () => {
    render(<AttributeFilter />);
    expect(screen.getByRole('button', { name: /lọc/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Bộ lọc dữ liệu')).not.toBeInTheDocument();
  });

  it('shows the panel when isOpen', () => {
    vm.isOpen = true;
    render(<AttributeFilter />);
    expect(screen.getByLabelText('Bộ lọc dữ liệu')).toBeInTheDocument();
  });

  it('funnel click toggles open (calls open when closed)', async () => {
    render(<AttributeFilter />);
    await userEvent.click(screen.getByRole('button', { name: /lọc/i }));
    expect(vm.open).toHaveBeenCalled();
  });
});
