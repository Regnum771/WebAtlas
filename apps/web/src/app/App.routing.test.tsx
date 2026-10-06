import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../components/DynamicPopup', () => ({ default: () => <div>POPUP</div> }));
vi.mock('../components/OGCClient', () => ({ default: () => <div>OGC</div> }));
vi.mock('../features/map/ui/MapToolbar', () => ({ default: () => <div>TOOLBAR</div> }));
vi.mock('../features/map/ui/MapLoadingBar', () => ({ default: () => null }));
vi.mock('../features/layers-panel', () => ({ default: () => <div>LAYERS</div> }));
vi.mock('../features/legend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../features/assistant', () => ({ default: () => <div>ASSISTANT</div> }));
vi.mock('../features/analysis', () => ({ useAnalysisTools: () => ({ buttons: null, panel: null }) }));
vi.mock('../features/roi/ui/RoiChip', () => ({ default: () => null }));
vi.mock('../features/roi/ui/RoiDrawButtons', () => ({ default: () => null }));
vi.mock('../features/feature-editing/ProposedEdit', () => ({ default: () => null }));
vi.mock('../entities/admin-unit/adminUnits.store', () => ({ primeAdminUnits: vi.fn(() => Promise.resolve()) }));
vi.mock('../widgets/top-bar', () => ({ default: () => <div>TOP_BAR</div> }));
vi.mock('../features/shell', () => ({ default: () => <div>SHELL</div> }));
vi.mock('../pages/admin-users', () => ({ default: () => <div>ADMIN_USERS</div> }));

import App from './App';

describe('App routing', () => {
  it('renders the map and no admin route at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
    expect(screen.queryByText('ADMIN_USERS')).not.toBeInTheDocument();
  });

  it('renders the admin route at /admin/users', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    expect(screen.getByText('ADMIN_USERS')).toBeInTheDocument();
  });

  it('KEEPS THE MAP MOUNTED at /admin/users (map is a sibling of Routes)', () => {
    window.history.pushState({}, '', '/admin/users');
    render(<App />);
    // This is the whole point of the sibling arrangement: OpenLayers must not
    // re-initialize and the user's center/zoom must survive navigation.
    expect(screen.getByText('MAP_VIEW')).toBeInTheDocument();
  });
});
