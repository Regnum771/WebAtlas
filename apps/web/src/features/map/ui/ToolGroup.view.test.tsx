import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolGroupView, type ToolDef } from './ToolGroup.view';

const TOOLS: ToolDef[] = [
  { id: 'measure', label: 'Đo', content: <p>MEASURE_BODY</p> },
  { id: 'roi', label: 'Vùng phân tích', on: true, content: <button type="button">INSIDE_ROI</button> },
  { id: 'basemap', label: 'Nền bản đồ', content: <p>BASEMAP_BODY</p> },
];

const renderGroup = (open: string | null, handlers: { onToggle?: (id: string) => void; onClose?: () => void } = {}) =>
  render(<ToolGroupView tools={TOOLS} open={open} onToggle={handlers.onToggle ?? vi.fn()} onClose={handlers.onClose ?? vi.fn()} />);

describe('ToolGroupView', () => {
  it('labels every tool with text', () => {
    renderGroup(null);
    for (const name of ['Đo', 'Vùng phân tích', 'Nền bản đồ']) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(name);
    }
  });

  it('ties each button to its menu and says which one is open', () => {
    renderGroup('roi');
    const open = screen.getByRole('button', { name: 'Vùng phân tích' });
    const closed = screen.getByRole('button', { name: 'Đo' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(open.getAttribute('aria-controls')!)).toBe(screen.getByRole('region', { name: 'Vùng phân tích' }));
    // A hidden element has no accessible name to query by, so the closed menu is read through its attributes.
    const closedMenu = document.getElementById(closed.getAttribute('aria-controls')!)!;
    expect(closedMenu).toHaveAttribute('role', 'region');
    expect(closedMenu).toHaveAttribute('aria-label', 'Đo');
    expect(closedMenu).toContainElement(screen.getByText('MEASURE_BODY'));
  });

  it('keeps a closed menu mounted but hidden', () => {
    renderGroup('roi');
    expect(screen.getByText('MEASURE_BODY')).toBeInTheDocument();
    expect(screen.getByText('MEASURE_BODY')).not.toBeVisible();
    expect(screen.getByText('BASEMAP_BODY')).not.toBeVisible();
    expect(screen.getByText('INSIDE_ROI')).toBeVisible();
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('hides every menu when none is open', () => {
    renderGroup(null);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getAllByRole('region', { hidden: true })).toHaveLength(3);
  });

  it('reports the tool whose button was pressed', async () => {
    const onToggle = vi.fn();
    renderGroup(null, { onToggle });
    await userEvent.click(screen.getByRole('button', { name: 'Nền bản đồ' }));
    expect(onToggle).toHaveBeenCalledWith('basemap');
  });

  it('Escape closes the menu and returns focus to its button', async () => {
    const onClose = vi.fn();
    renderGroup('roi', { onClose });
    screen.getByRole('button', { name: 'INSIDE_ROI' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Vùng phân tích' })).toHaveFocus();
  });

  it('Escape on another tool\'s button closes the open menu too', async () => {
    const onClose = vi.fn();
    renderGroup('roi', { onClose });
    screen.getByRole('button', { name: 'Đo' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Vùng phân tích' })).toHaveFocus();
  });

  it('Escape does nothing when no menu is open', async () => {
    const onClose = vi.fn();
    renderGroup(null, { onClose });
    const button = screen.getByRole('button', { name: 'Đo' });
    button.focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('fills the button of a tool that is on', () => {
    renderGroup(null);
    expect(screen.getByRole('button', { name: 'Vùng phân tích' })).toHaveClass('is-on');
    expect(screen.getByRole('button', { name: 'Đo' })).not.toHaveClass('is-on');
  });

  it('fills the button of the open tool', () => {
    renderGroup('measure');
    expect(screen.getByRole('button', { name: 'Đo' })).toHaveClass('is-on');
    expect(screen.getByRole('button', { name: 'Nền bản đồ' })).not.toHaveClass('is-on');
  });
});
