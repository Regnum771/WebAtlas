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
