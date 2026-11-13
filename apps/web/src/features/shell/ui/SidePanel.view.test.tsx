import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SidePanelView } from './SidePanel.view';

describe('SidePanelView', () => {
  it('is a named complementary landmark with body and footer', () => {
    render(<SidePanelView footer={<span>FOOT</span>}><span>BODY</span></SidePanelView>);
    const panel = screen.getByRole('complementary', { name: 'Bảng bản đồ' });
    expect(within(panel).getByText('BODY').closest('.side-panel-body')).not.toBeNull();
    expect(within(panel).getByText('FOOT').closest('.side-panel-footer')).not.toBeNull();
  });
});

describe('SidePanelView placement', () => {
  it('floats over the map right of the rail, 312 px wide, clear of the status bar, with a solid 1 px border', () => {
    render(<SidePanelView footer={null}><span>BODY</span></SidePanelView>);
    const panel = screen.getByRole('complementary', { name: 'Bảng bản đồ' });
    // No data-slot: the legacy content inside keeps its browser defaults.
    expect(panel).not.toHaveAttribute('data-slot');
    for (const c of ['absolute', 'top-2', 'left-[calc(var(--contents-rail)+16px)]', 'bottom-[calc(40px+var(--time-row-height,0px))]', 'w-[var(--panel-width)]', 'border', 'border-solid', 'rounded-lg']) {
      expect(panel).toHaveClass(c);
    }
  });
});

describe('SidePanelView folded', () => {
  it('stays mounted but hidden, its content kept', () => {
    render(<SidePanelView footer={null} collapsed><span>BODY</span></SidePanelView>);
    expect(screen.queryByRole('complementary', { name: 'Bảng bản đồ' })).toBeNull();
    expect(screen.getByText('BODY', { selector: 'span' })).not.toBeVisible();
  });
});
