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
// layer catalog stub
vi.mock('../../entities/layer/useLayerCatalog', () => ({
  useLayerCatalog: () => ({ data: [{ key: 'dams', geomType: 'Point', attributes: ['name', 'status'] }], isLoading: false }),
}));

import FeatureEditing from './index';

// Editing an already-selected feature (pen, attribute form, delete) moved to
// widgets/display-panel — see its index.test.tsx for that coverage, including the
// delete-reachability regression test. This drawer now only hosts draw/create.
describe('FeatureEditing', () => {
  it('renders the toolbar with the layer picker and a draw control for an admin', () => {
    render(<FeatureEditing />);
    expect(screen.getByText('Add a feature')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /dams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draw/i })).toBeInTheDocument();
  });
});
