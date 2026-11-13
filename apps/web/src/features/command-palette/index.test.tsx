import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import CommandPalette from './index';
import { isTypingTarget, parseLatLon } from './model/useCommandPalette';
import { getShell, resetShell } from '../shell/model/shell.store';
import * as api from '../search/api/search.api';

// cmdk scrolls the selected item into view; jsdom has neither of these.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const run = vi.fn();
vi.mock('../map/model/mapCommands', () => ({ createCommandExecutor: () => run }));
const layersState = [
  { id: 'layer_dams', visible: true, opacity: 1 },
  { id: 'layer_lakes', visible: false, opacity: 1 },
  { id: 'layer_rivers', visible: true, opacity: 1 },
];
vi.mock('../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ map: null, setBasemap: vi.fn(), toggleLayerVisibility: vi.fn(), setLayerOpacity: vi.fn(), layersState }),
}));
let signedIn = true;
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ status: signedIn ? 'authenticated' : 'anonymous' }),
}));
vi.mock('../roi/ui/UseAsRoiButton', () => ({ UseAsRoiButton: () => null }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
const renderPalette = () => render(
  <MemoryRouter initialEntries={['/ban-do']}>
    <CommandPalette />
    <input aria-label="Ô khác" />
    <Routes><Route path="*" element={<Where />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { run.mockClear(); resetShell(); signedIn = true; vi.restoreAllMocks(); });

describe('parseLatLon and isTypingTarget', () => {
  it('reads "lat, lon" in decimal degrees, with a dot or, after a semicolon, a comma', () => {
    expect(parseLatLon('15.88, 108.33')).toEqual({ lat: 15.88, lon: 108.33 });
    expect(parseLatLon('15.88 108.33')).toEqual({ lat: 15.88, lon: 108.33 });
    expect(parseLatLon('15,88; 108,33')).toEqual({ lat: 15.88, lon: 108.33 });
    expect(parseLatLon('108.33, 95')).toBeNull();
    expect(parseLatLon('Hội An')).toBeNull();
    expect(parseLatLon('15.88')).toBeNull();
  });

  it('counts text fields, textareas, selects and editable elements as typing, not checkboxes', () => {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild!; };
    expect(isTypingTarget(el('<input type="text">'))).toBe(true);
    expect(isTypingTarget(el('<input type="search">'))).toBe(true);
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(el('<select></select>'))).toBe(true);
    const editable = el('<div contenteditable="true"></div>') as HTMLElement;
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isTypingTarget(el('<button></button>'))).toBe(false);
  });
});

describe('CommandPalette', () => {
  it('the header field opens the palette, and Escape closes it', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole('button', { name: /Tìm địa danh, lớp, toạ độ, lệnh/ }));
    expect(screen.getByRole('dialog', { name: 'Bảng lệnh' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ctrl K opens it from anywhere but a text field, and Ctrl K in its own input closes it (Review Focus 3)', async () => {
    const user = userEvent.setup();
    renderPalette();
    screen.getByRole('textbox', { name: 'Ô khác' }).focus();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).toBeNull();
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('/ opens Trợ lý, but not while typing, and not for a visitor', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPalette();
    screen.getByRole('textbox', { name: 'Ô khác' }).focus();
    await user.keyboard('/');
    expect(getShell().assistantOpen).toBe(false);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('/');
    expect(getShell().assistantOpen).toBe(true);
    unmount();
    resetShell();
    signedIn = false;
    renderPalette();
    await user.keyboard('/');
    expect(getShell().assistantOpen).toBe(false);
  });

  it('typing queries the place search, and choosing a place closes the palette and moves there', async () => {
    const fetchSearch = vi.spyOn(api, 'fetchSearch').mockResolvedValue([
      { layerKey: 'roads', featureId: 'r:1', name: 'Quốc lộ 14', source: 'reference', lonLat: [108.05, 12.67] },
    ]);
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole('button', { name: /Tìm địa danh/ }));
    await user.type(screen.getByRole('combobox'), 'quoc lo');
    const place = await screen.findByRole('option', { name: /Quốc lộ 14/ });
    expect(fetchSearch).toHaveBeenCalled();
    expect(place).toHaveTextContent('Nền bản đồ');
    await user.click(place);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'showGeometries', fit: true }));
  });

  it('lists layers by name, without accents, and choosing one toggles it', async () => {
    vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole('button', { name: /Tìm địa danh/ }));
    await user.type(screen.getByRole('combobox'), 'ho chua');
    const lakes = await screen.findByRole('option', { name: /Hồ & Hồ chứa/ });
    expect(lakes).toHaveTextContent('Bật');
    await user.click(lakes);
    expect(run).toHaveBeenCalledWith({ kind: 'setLayerVisible', layerStateId: 'layer_lakes', visible: true });
  });

  it('offers Đến toạ độ for a typed "lat, lon" and goes there', async () => {
    vi.spyOn(api, 'fetchSearch').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPalette();
    await user.click(screen.getByRole('button', { name: /Tìm địa danh/ }));
    await user.type(screen.getByRole('combobox'), '15.88, 108.33');
    await user.click(await screen.findByRole('option', { name: /Đến toạ độ/ }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'showGeometries', fit: true, items: [expect.objectContaining({ geometry: { type: 'Point', coordinates: [108.33, 15.88] } })],
    }));
  });

  it('runs the commands: Tắt hết lớp, In và xuất, Trợ lý', async () => {
    const user = userEvent.setup();
    renderPalette();
    const open = () => user.click(screen.getByRole('button', { name: /Tìm địa danh/ }));
    await open();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Tắt hết lớp', 'In và xuất', 'Trợ lý/']);
    await user.click(screen.getByRole('option', { name: 'Tắt hết lớp' }));
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: false },
      { kind: 'setLayerVisible', layerStateId: 'layer_rivers', visible: false },
    ]);
    await open();
    await user.click(screen.getByRole('option', { name: 'In và xuất' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/print'));
    await open();
    await user.click(screen.getByRole('option', { name: /Trợ lý/ }));
    expect(getShell().assistantOpen).toBe(true);
  });
});
