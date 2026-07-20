import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let vm: Record<string, unknown>;
let layersState: { id: string; visible: boolean }[];
const toggleLayerVisibility = vi.fn();
vi.mock('./model/useFilterPresenter', () => ({ useFilterPresenter: () => vm }));
vi.mock('../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ layersState, toggleLayerVisibility }),
}));

import AttributeFilter from './index';

beforeEach(() => {
  toggleLayerVisibility.mockClear();
  layersState = [{ id: 'layer_stations', visible: false }];
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

  it('enable turns the layer on when it is OFF', async () => {
    vm.isOpen = true; vm.layerKey = 'stations'; vm.layerLoaded = false;
    layersState = [{ id: 'layer_stations', visible: false }];
    render(<AttributeFilter />);
    await userEvent.click(screen.getByRole('button', { name: /bật lớp/i }));
    expect(toggleLayerVisibility).toHaveBeenCalledWith('layer_stations');
  });

  it('enable does NOT toggle a layer that is already visible (regression: was turning it OFF)', async () => {
    vm.isOpen = true; vm.layerKey = 'stations'; vm.layerLoaded = false;
    layersState = [{ id: 'layer_stations', visible: true }]; // visible but still loading
    render(<AttributeFilter />);
    await userEvent.click(screen.getByRole('button', { name: /bật lớp/i }));
    expect(toggleLayerVisibility).not.toHaveBeenCalled();
  });
});
