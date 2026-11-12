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
  it('floats over the map, 312 px wide, clear of the status bar, with a solid 1 px border', () => {
    render(<SidePanelView footer={null}><span>BODY</span></SidePanelView>);
    const panel = screen.getByRole('complementary', { name: 'Bảng bản đồ' });
    // No data-slot: the legacy content inside keeps its browser defaults.
    expect(panel).not.toHaveAttribute('data-slot');
    for (const c of ['absolute', 'top-2', 'left-2', 'bottom-10', 'w-[var(--panel-width)]', 'border', 'border-solid', 'rounded-lg']) {
      expect(panel).toHaveClass(c);
    }
  });
});
