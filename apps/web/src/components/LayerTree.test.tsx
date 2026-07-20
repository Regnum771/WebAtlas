import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setBasemap = vi.fn();
vi.mock('../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    basemap: 'street',
    setBasemap,
    layersState: [{ id: 'layer_dams', visible: true, opacity: 1 }],
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
  }),
}));
vi.mock('../data/mockData', () => ({
  layerGroups: [
    { id: 'group_water_resources', name: 'Tài nguyên nước', layers: [{ id: 'layer_dams', name: 'Đập & Hồ chứa' }] },
  ],
}));

import LayerTree from './LayerTree';

describe('LayerTree with the merged basemap section', () => {
  it('renders the Bản đồ nền section', () => {
    render(<LayerTree />);
    expect(screen.getByText('Bản đồ nền')).toBeInTheDocument();
  });

  it('still renders the layer groups', () => {
    render(<LayerTree />);
    expect(screen.getByText('Tài nguyên nước')).toBeInTheDocument();
  });

  it('basemap buttons still switch the basemap', async () => {
    render(<LayerTree />);
    await userEvent.click(screen.getByRole('button', { name: /vệ tinh/i }));
    expect(setBasemap).toHaveBeenCalledWith('satellite');
  });
});
