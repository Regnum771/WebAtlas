import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolGroupView, type ToolDef } from './ToolGroup.view';

// Radix measures the anchor; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

const icon = <svg aria-hidden="true" />;
const onPrint = vi.fn();
const TOOLS: ToolDef[] = [
  { id: 'measure', label: 'Đo', icon, stack: 'analysis', content: <p>MEASURE_BODY</p> },
  { id: 'roi', label: 'Vùng phân tích', icon, stack: 'analysis', on: true, content: <button type="button">INSIDE_ROI</button> },
  { id: 'profile', label: 'Trắc diện độ cao', icon, stack: 'analysis', opens: 'roi' },
  { id: 'print', label: 'In và xuất', icon, stack: 'analysis', onSelect: onPrint },
  { id: 'add-data', label: 'Thêm dữ liệu', icon, stack: 'data', content: <p>ADD_BODY</p> },
  { id: 'basemap', label: 'Nền bản đồ', icon, stack: 'basemap', content: <p>BASEMAP_BODY</p> },
];

const renderGroup = (open: string | null, handlers: { onToggle?: (id: string) => void; onClose?: () => void } = {}) =>
  render(<ToolGroupView tools={TOOLS} open={open} onToggle={handlers.onToggle ?? vi.fn()} onClose={handlers.onClose ?? vi.fn()} />);

describe('ToolGroupView', () => {
  it('puts the tools in their stacks, in order, each a named icon button', () => {
    renderGroup(null);
    const stacks = screen.getAllByRole('group');
    expect(stacks.map((g) => g.getAttribute('aria-label'))).toEqual(['Đo và phân tích', 'Dữ liệu', 'Nền bản đồ']);
    expect(within(stacks[0]).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Đo', 'Vùng phân tích', 'Trắc diện độ cao', 'In và xuất']);
    expect(stacks.every((g) => g.getAttribute('data-slot') === 'tool-stack')).toBe(true);
  });

  it('names each button in a tooltip on hover', async () => {
    const user = userEvent.setup();
    renderGroup(null);
    await user.hover(screen.getByRole('button', { name: 'Nền bản đồ' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nền bản đồ');
  });

  it('ties each button to its menu and says which one is open', () => {
    renderGroup('roi');
    const open = screen.getByRole('button', { name: 'Vùng phân tích' });
    const closed = screen.getByRole('button', { name: 'Đo' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(open.getAttribute('aria-controls')!)).toBe(screen.getByRole('region', { name: 'Vùng phân tích' }));
    const closedMenu = document.getElementById(closed.getAttribute('aria-controls')!)!;
    expect(closedMenu).toHaveAttribute('aria-label', 'Đo');
    expect(closedMenu).toContainElement(screen.getByText('MEASURE_BODY'));
  });

  it('keeps a closed menu mounted but hidden, and only the open one shows', () => {
    renderGroup('roi');
    expect(screen.getByText('MEASURE_BODY')).not.toBeVisible();
    expect(screen.getByText('BASEMAP_BODY')).not.toBeVisible();
    expect(screen.getByText('INSIDE_ROI')).toBeVisible();
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getAllByRole('region', { hidden: true })).toHaveLength(4);
  });

  it('draws the zoom stack first, above the tool stacks', () => {
    render(<ToolGroupView before={<div role="group" aria-label="Phóng to, thu nhỏ" />} tools={TOOLS} open={null} onToggle={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole('group')[0]).toHaveAttribute('aria-label', 'Phóng to, thu nhỏ');
  });

  it('a menu is not a primitive scope: its legacy body keeps the browser defaults', () => {
    renderGroup('roi');
    const menu = screen.getByRole('region', { name: 'Vùng phân tích' });
    expect(menu).not.toHaveAttribute('data-slot');
    expect(menu).toHaveClass('tool-menu');
  });

  it('tints a tool that holds something, and the open one', () => {
    renderGroup('measure');
    expect(screen.getByRole('button', { name: 'Vùng phân tích' })).toHaveAttribute('data-on', 'true');
    expect(screen.getByRole('button', { name: 'Đo' })).toHaveAttribute('data-on', 'true');
    expect(screen.getByRole('button', { name: 'Nền bản đồ' })).not.toHaveAttribute('data-on');
  });

  it('reports the tool whose button was pressed; Trắc diện độ cao opens Vùng phân tích', async () => {
    const onToggle = vi.fn();
    renderGroup(null, { onToggle });
    await userEvent.click(screen.getByRole('button', { name: 'Nền bản đồ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Trắc diện độ cao' }));
    expect(onToggle.mock.calls).toEqual([['basemap'], ['roi']]);
  });

  it('In và xuất runs its action and opens no menu', async () => {
    const onToggle = vi.fn();
    onPrint.mockClear();
    renderGroup(null, { onToggle });
    const print = screen.getByRole('button', { name: 'In và xuất' });
    expect(print).not.toHaveAttribute('aria-expanded');
    await userEvent.click(print);
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('Escape closes the menu and returns focus to its button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderGroup('roi', { onClose });
    screen.getByRole('button', { name: 'INSIDE_ROI' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Vùng phân tích' })).toHaveFocus();
  });

  it('a press outside, on the map, leaves the menu open', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = renderGroup('measure', { onClose });
    const outside = document.createElement('div');
    container.appendChild(outside);
    await user.click(outside);
    expect(onClose).not.toHaveBeenCalled();
  });
});
