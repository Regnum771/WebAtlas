import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

const bridge = vi.hoisted(() => ({
  enterEditMode: vi.fn(), startModify: vi.fn(), updateFeature: vi.fn(),
}));

// admin session so RequireRole passes
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' }, status: 'authenticated', login: vi.fn(), logout: vi.fn() }),
}));
// map editing bridge stub
vi.mock('../map/model/mapEditing', () => ({
  useMapEditing: () => ({
    hasMap: true, startDraw: vi.fn(), cancelDraw: vi.fn(), refreshLayer: vi.fn(), registerRefresh: vi.fn(),
    editing: false, enterEditMode: bridge.enterEditMode, exitEditMode: vi.fn(), startModify: bridge.startModify,
    cancelModify: vi.fn(), clearSelection: vi.fn(),
  }),
}));
// layer catalog stub
vi.mock('../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({ data: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }], isLoading: false }),
}));
vi.mock('./api/features.api', () => ({
  createFeature: vi.fn(), deleteFeature: vi.fn(),
  updateFeature: (...a: unknown[]) => bridge.updateFeature(...a),
}));

import FeatureEditing from './index';

describe('FeatureEditing', () => {
  it('renders the toolbar with the layer picker and a draw control for an admin', () => {
    render(<FeatureEditing />);
    expect(screen.getByText('Add a feature')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draw/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit existing/i })).toBeInTheDocument();
  });
});

describe('FeatureEditing: saving an edited river', () => {
  // What selection hands over for a tile river: the SIMPLIFIED shape from the geometry endpoint.
  const simplified = { type: 'MultiLineString', coordinates: [[[108, 13], [108.2, 13.2]]] };
  const moved = { type: 'MultiLineString', coordinates: [[[108, 13], [108.1, 13.05], [108.2, 13.2]]] };

  beforeEach(() => {
    bridge.enterEditMode.mockReset();
    bridge.startModify.mockReset();
    bridge.updateFeature.mockReset().mockResolvedValue({ id: 'u1' });
  });

  function selectRiver() {
    render(<FeatureEditing />);
    fireEvent.click(screen.getByRole('button', { name: /edit existing/i }));
    const onSelected = bridge.enterEditMode.mock.calls[0][0];
    act(() => onSelected({
      layerKey: 'rivers', featureId: 'u1', geometry: simplified,
      isoProps: { id: 'u1', layerKey: 'rivers', geographicalName: 'Sông X', streamOrder: 5 },
    }));
  }

  it('an attribute-only save sends no geometry, so the stored shape is kept', async () => {
    selectRiver();
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(bridge.updateFeature).toHaveBeenCalledTimes(1));
    const [key, id, payload] = bridge.updateFeature.mock.calls[0];
    expect([key, id]).toEqual(['rivers', 'u1']);
    expect(payload).not.toHaveProperty('geometry');
    expect(payload.properties.name).toBe('Sông X');
  });

  it('a save after a Modify sends the modified geometry', async () => {
    selectRiver();
    const onGeometryChange = bridge.startModify.mock.calls[0][0];
    act(() => onGeometryChange(moved));
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(bridge.updateFeature).toHaveBeenCalledTimes(1));
    expect(bridge.updateFeature.mock.calls[0][2].geometry).toEqual(moved);
  });
});
