import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../app/providers/MapProvider', () => ({
  useMapContext: () => ({
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

// LayerTree is dead code (nothing mounts it — see task-7-report.md), and its
// basemap section was removed rather than duplicated when BasemapSwitcher.tsx
// was deleted (basemap selection now lives only in features/map/ui/MapToolbar).
// This is the one assertion left that isn't about a feature no user can reach.
describe('LayerTree', () => {
  it('still renders the layer groups', () => {
    render(<LayerTree />);
    expect(screen.getByText('Tài nguyên nước')).toBeInTheDocument();
  });
});
