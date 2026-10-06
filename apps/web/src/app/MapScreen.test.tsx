import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../features/map/ui/MapLoadingBar', () => ({ default: () => <div>LOADING</div> }));
vi.mock('../features/map/ui/MapToolbar', () => ({ default: () => <div>TOOLBAR</div> }));
vi.mock('../features/layers-panel', () => ({ default: () => <div>LAYERS</div> }));
vi.mock('../features/legend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../features/assistant', () => ({ default: () => <div>ASSISTANT</div> }));
vi.mock('../features/analysis', () => ({ useAnalysisTools: () => ({ buttons: null, panel: null }) }));
vi.mock('../features/roi/ui/RoiChip', () => ({ default: () => null }));
vi.mock('../features/roi/ui/RoiDrawButtons', () => ({ default: () => null }));
vi.mock('../widgets/top-bar', () => ({ default: () => <div>TOP_BAR</div> }));
vi.mock('../entities/admin-unit/adminUnits.store', () => ({ primeAdminUnits: vi.fn(() => Promise.resolve()) }));

let mockStatus: 'authenticated' | 'anonymous' = 'anonymous';
vi.mock('../entities/session/model/session.store', () => ({
  useSession: () => ({ status: mockStatus }),
}));

import MapScreen from './MapScreen';
import { resetShell, toggleAssistant, getShell } from '../features/shell/model/shell.store';

const renderScreen = () => render(<MemoryRouter><MapScreen /></MemoryRouter>);

beforeEach(() => { mockStatus = 'anonymous'; resetShell(); });

describe('MapScreen', () => {
  it('shows the layer list and the legend together in the side panel', () => {
    renderScreen();
    const panel = screen.getByRole('complementary', { name: 'Bảng bản đồ' });
    expect(within(panel).getByText('LAYERS')).toBeInTheDocument();
    expect(within(panel).getByText('LEGEND')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'In và xuất' })).toHaveAttribute('href', '/print');
  });

  it('puts the map and its floats in the stage, and the top bar in its slot', () => {
    const { container } = renderScreen();
    const stage = container.querySelector('.map-stage') as HTMLElement;
    expect(within(stage).getByText('MAP_VIEW')).toBeInTheDocument();
    expect(within(stage).getByText('TOOLBAR')).toBeInTheDocument();
    expect(screen.getByText('TOP_BAR')).toBeInTheDocument();
  });

  it('has no rail and no flyout', () => {
    const { container } = renderScreen();
    expect(container.querySelector('.icon-rail, .rail-flyout')).toBeNull();
  });

  it('docks the assistant when it is opened and the user is signed in', () => {
    mockStatus = 'authenticated';
    renderScreen();
    expect(screen.queryByRole('complementary', { name: 'Trợ lý' })).toBeNull();
    act(() => { toggleAssistant(); });
    const dock = screen.getByRole('complementary', { name: 'Trợ lý' });
    expect(within(dock).getByText('ASSISTANT')).toBeInTheDocument();
  });

  it('does not dock the assistant for an anonymous visitor', () => {
    renderScreen();
    act(() => { toggleAssistant(); });
    expect(screen.queryByRole('complementary', { name: 'Trợ lý' })).toBeNull();
  });

  it('closes the assistant when the session ends', () => {
    mockStatus = 'authenticated';
    toggleAssistant();
    const { rerender } = renderScreen();
    expect(screen.getByRole('complementary', { name: 'Trợ lý' })).toBeInTheDocument();
    mockStatus = 'anonymous';
    rerender(<MemoryRouter><MapScreen /></MemoryRouter>);
    expect(screen.queryByRole('complementary', { name: 'Trợ lý' })).toBeNull();
    expect(getShell().assistantOpen).toBe(false);
  });
});
