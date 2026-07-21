import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// admin session so RequireRole passes
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' }, status: 'authenticated', login: vi.fn(), logout: vi.fn() }),
}));
// map editing bridge stub
vi.mock('../map/model/mapEditing', () => ({
  useMapEditing: () => ({
    hasMap: true, startDraw: vi.fn(), cancelDraw: vi.fn(), refreshLayer: vi.fn(), registerRefresh: vi.fn(),
    registerSetSelectActive: vi.fn(), startModify: vi.fn(), cancelModify: vi.fn(),
  }),
}));
// shared selection stub — nothing selected by default
vi.mock('../../entities/selection', () => ({
  useSelection: () => ({ selection: null, selectById: vi.fn(), clear: vi.fn() }),
}));
// layer catalog stub
vi.mock('../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({ data: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }], isLoading: false }),
}));

import FeatureEditing from './index';

describe('FeatureEditing', () => {
  it('renders the toolbar with the layer picker and a draw control for an admin', () => {
    render(<FeatureEditing />);
    expect(screen.getByText('Add a feature')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draw/i })).toBeInTheDocument();
  });

  it('renders nothing for edit-existing when nothing is selected (the display panel pen drives it now)', () => {
    render(<FeatureEditing />);
    expect(screen.queryByRole('button', { name: /edit existing/i })).not.toBeInTheDocument();
  });
});
