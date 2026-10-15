import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ResolvedRoi } from '@webatlas/shared';

vi.mock('../features/map/ui/MapView', () => ({ default: () => <div>MAP_VIEW</div> }));
vi.mock('../features/map/ui/MapLoadingBar', () => ({ default: () => <div>LOADING</div> }));
vi.mock('../features/map/ui/ScaleSlider', () => ({ default: () => <div>SCALE_SLIDER</div> }));
vi.mock('../features/map/ui/MeasureTool', () => ({ default: ({ active }: { active: boolean }) => <div>{`MEASURE:${active}`}</div> }));
vi.mock('../features/map/ui/BasemapTool', () => ({ default: () => <div>BASEMAP</div> }));
vi.mock('../features/add-data', () => ({ default: () => <div>ADD_DATA</div> }));
const editing = vi.hoisted(() => ({ onBusyChange: undefined as ((busy: boolean) => void) | undefined }));
vi.mock('../features/feature-editing', () => ({
  default: ({ active, onBusyChange }: { active: boolean; onBusyChange?: (busy: boolean) => void }) => {
    editing.onBusyChange = onBusyChange;
    return <div>{`FEATURE_EDITING:${active}`}</div>;
  },
}));
vi.mock('../features/layers-panel', () => ({ default: () => <div>LAYERS</div> }));
vi.mock('../features/legend', () => ({ default: () => <div>LEGEND</div> }));
vi.mock('../features/assistant', () => ({ default: () => <div>ASSISTANT</div> }));
vi.mock('../features/flood-scenario', () => ({
  default: () => <div>FLOOD_DOCK</div>,
  FloodLegend: () => <div>FLOOD_LEGEND</div>,
  FloodScenarioToolContent: () => <div>FLOOD_MENU</div>,
}));
vi.mock('../features/analysis', () => ({ useAnalysisTools: () => ({ buttons: <div>ANALYSIS_BUTTONS</div>, panel: <div>ANALYSIS_PANEL</div> }) }));
vi.mock('../features/roi/ui/RoiChip', () => ({ default: () => <div>ROI_STATUS</div> }));
vi.mock('../features/roi/ui/RoiDrawButtons', () => ({ default: () => <div>ROI_DRAW</div> }));
vi.mock('../widgets/top-bar', () => ({ default: () => <div>TOP_BAR</div> }));
vi.mock('../entities/admin-unit/adminUnits.store', () => ({ primeAdminUnits: vi.fn(() => Promise.resolve()) }));

type MockRole = 'admin' | 'editor' | 'viewer';
let mockStatus: 'authenticated' | 'anonymous' = 'anonymous';
let mockUser: { role: MockRole } | null = null;
vi.mock('../entities/session/model/session.store', () => ({
  useSession: () => ({ status: mockStatus, currentUser: mockUser }),
}));

import MapScreen from './MapScreen';
import { resetShell, toggleAssistant, getShell, openTool, closeTool } from '../features/shell/model/shell.store';
import { getRoiState, resetRoiStore, setRoi, setRoiHint, setRoiResolver, startDrawing } from '../features/roi/model/roi.store';

const renderScreen = () => render(<MemoryRouter><MapScreen /></MemoryRouter>);
const signIn = (role: MockRole) => { mockStatus = 'authenticated'; mockUser = { role }; };
const signOut = () => { mockStatus = 'anonymous'; mockUser = null; };

const PROVINCE = { source: 'admin', level: 'province', code: '66' } as const;
const RESOLVED: ResolvedRoi = {
  label: 'Tỉnh Đắk Lắk', kind: 'area', measure: { areaKm2: 18086 },
  display: { type: 'Point', coordinates: [108, 12.7] }, bbox: [107, 12, 109, 13.5], centroid: [108, 12.7],
};
const never = () => new Promise<ResolvedRoi>(() => {});
/** A tool's menu, open or not: a hidden region has no accessible name to query by. */
const menuOf = (tool: string) =>
  document.getElementById(screen.getByRole('button', { name: tool }).getAttribute('aria-controls')!) as HTMLElement;

beforeEach(() => { signOut(); resetShell(); resetRoiStore(); });

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
    expect(within(stage).getByRole('button', { name: 'Đo' })).toBeInTheDocument();
    expect(within(stage).getByText('SCALE_SLIDER')).toBeInTheDocument();
    expect(screen.getByText('TOP_BAR')).toBeInTheDocument();
  });

  it('has no rail and no flyout', () => {
    const { container } = renderScreen();
    expect(container.querySelector('.icon-rail, .rail-flyout')).toBeNull();
  });

  it('docks the assistant when it is opened and the user is signed in', () => {
    signIn('viewer');
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
    signIn('viewer');
    toggleAssistant();
    const { rerender } = renderScreen();
    expect(screen.getByRole('complementary', { name: 'Trợ lý' })).toBeInTheDocument();
    signOut();
    rerender(<MemoryRouter><MapScreen /></MemoryRouter>);
    expect(screen.queryByRole('complementary', { name: 'Trợ lý' })).toBeNull();
    expect(getShell().assistantOpen).toBe(false);
  });
});

describe('MapScreen tool group', () => {
  it('offers the five reader tools, in order, with every menu closed', () => {
    const { container } = renderScreen();
    const group = container.querySelector('.tool-group') as HTMLElement;
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Đo', 'Vùng phân tích', 'Thêm dữ liệu', 'Nền bản đồ', 'Kịch bản lũ',
    ]);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(getShell().tool).toBeNull();
  });

  it('opens a tool from its button, one at a time, and closes it from the same button', async () => {
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'Thêm dữ liệu' }));
    expect(within(screen.getByRole('region', { name: 'Thêm dữ liệu' })).getByText('ADD_DATA')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Nền bản đồ' }));
    expect(within(screen.getByRole('region', { name: 'Nền bản đồ' })).getByText('BASEMAP')).toBeVisible();
    expect(screen.getAllByRole('region')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Nền bản đồ' }));
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('lays out Vùng phân tích as status, drawing, tools, then the form or result', () => {
    renderScreen();
    expect(Array.from(menuOf('Vùng phân tích').children).map((c) => c.textContent)).toEqual([
      'ROI_STATUS', 'ROI_DRAW', 'ANALYSIS_BUTTONS', 'ANALYSIS_PANEL',
    ]);
  });

  it('tells the measure tool whether its menu is open', async () => {
    renderScreen();
    expect(screen.getByText('MEASURE:false')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Đo' }));
    expect(screen.getByText('MEASURE:true')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vùng phân tích' }));
    expect(screen.getByText('MEASURE:false')).toBeInTheDocument();
  });

  it('shows Biên tập to an admin only', () => {
    signIn('admin');
    const { unmount } = renderScreen();
    expect(screen.getByRole('button', { name: 'Biên tập' })).toBeInTheDocument();
    expect(within(menuOf('Biên tập')).getByText(/^FEATURE_EDITING/)).toBeInTheDocument();
    unmount();

    for (const role of ['viewer', 'editor'] as const) {
      signIn(role);
      const view = renderScreen();
      expect(screen.queryByRole('button', { name: 'Biên tập' })).toBeNull();
      expect(screen.queryByText(/^FEATURE_EDITING/)).toBeNull();
      view.unmount();
    }

    signOut();
    renderScreen();
    expect(screen.queryByRole('button', { name: 'Biên tập' })).toBeNull();
    expect(screen.queryByText(/^FEATURE_EDITING/)).toBeNull();
  });

  it('closes Biên tập when the session ends', () => {
    signIn('admin');
    openTool('edit');
    const { rerender } = renderScreen();
    expect(getShell().tool).toBe('edit');
    expect(screen.getByRole('region', { name: 'Biên tập' })).toBeVisible();
    signOut();
    rerender(<MemoryRouter><MapScreen /></MemoryRouter>);
    expect(getShell().tool).toBeNull();
    expect(screen.queryByRole('button', { name: 'Biên tập' })).toBeNull();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('tells Biên tập whether its menu is open', async () => {
    signIn('admin');
    renderScreen();
    expect(screen.getByText('FEATURE_EDITING:false')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Biên tập' }));
    expect(screen.getByText('FEATURE_EDITING:true')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Đo' }));
    expect(screen.getByText('FEATURE_EDITING:false')).toBeInTheDocument();
  });

  it('fills Biên tập while a feature drawing or edit-existing mode is active', () => {
    signIn('admin');
    renderScreen();
    const button = screen.getByRole('button', { name: 'Biên tập' });
    expect(button).not.toHaveClass('is-on');
    act(() => { editing.onBusyChange?.(true); });
    expect(button).toHaveClass('is-on');
    act(() => { editing.onBusyChange?.(false); });
    expect(button).not.toHaveClass('is-on');
  });

  it('does not let a non-admin open Biên tập', () => {
    signIn('editor');
    renderScreen();
    act(() => { openTool('edit'); });
    expect(getShell().tool).toBeNull();
  });

  it('opens Vùng phân tích when a region starts resolving', () => {
    setRoiResolver(never);
    renderScreen();
    expect(getShell().tool).toBeNull();
    act(() => { void setRoi(PROVINCE, { fit: true }); });
    expect(getRoiState().status).toBe('resolving');
    expect(getShell().tool).toBe('roi');
    expect(screen.getByRole('region', { name: 'Vùng phân tích' })).toBeVisible();
  });

  it('opens Vùng phân tích over another tool when the region store has something to say', async () => {
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'Đo' }));
    act(() => { setRoiHint('Vùng tự cắt nhau — hãy vẽ lại'); });
    expect(getShell().tool).toBe('roi');
  });

  it('reopens Vùng phân tích for a pick that fails again after the menu was closed', async () => {
    setRoiResolver(() => Promise.reject(new Error('down')));
    renderScreen();
    await act(async () => { await setRoi(PROVINCE, { fit: true }); });
    expect(getRoiState().error).toBe('Không xác định được vùng phân tích.');
    act(() => { closeTool(); });
    expect(getShell().tool).toBeNull();
    await act(async () => { await setRoi(PROVINCE, { fit: true }); });
    expect(getShell().tool).toBe('roi');
  });

  it('leaves a closed menu closed when the region has not changed', async () => {
    setRoiResolver(() => Promise.resolve(RESOLVED));
    renderScreen();
    await act(async () => { await setRoi(PROVINCE, { fit: true }); });
    act(() => { closeTool(); });
    act(() => { toggleAssistant(); });
    expect(getShell().tool).toBeNull();
  });

  it('fills Vùng phân tích while a region is resolved, and keeps the region when the menu closes', async () => {
    setRoiResolver(() => Promise.resolve(RESOLVED));
    renderScreen();
    const button = screen.getByRole('button', { name: 'Vùng phân tích' });
    expect(button).not.toHaveClass('is-on');
    await act(async () => { await setRoi(PROVINCE, { fit: true }); });
    act(() => { closeTool(); });
    expect(button).toHaveClass('is-on');
    expect(getRoiState().resolved).toBe(RESOLVED);
  });

  it('cancels a drawing in progress when Vùng phân tích closes', async () => {
    renderScreen();
    await userEvent.click(screen.getByRole('button', { name: 'Vùng phân tích' }));
    act(() => { startDrawing('Polygon'); });
    expect(getRoiState().status).toBe('drawing');
    await userEvent.click(screen.getByRole('button', { name: 'Đo' }));
    expect(getRoiState()).toMatchObject({ status: 'empty', drawKind: null });
  });

  it('has no bottom toolbar, no hint strip and no floating WMS button', () => {
    const { container } = renderScreen();
    expect(container.querySelector('.map-toolbar, .toolbar-rail, .ogc-trigger-btn, .burger-btn')).toBeNull();
  });
});
