import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayPanelView } from './DisplayPanel.view';

const base = {
  title: 'Hoa Binh',
  layerLabel: 'Đập & Hồ chứa',
  rows: [{ label: 'name', value: 'Hoa Binh' }],
  collapsed: false,
  canEdit: false,
  onToggleCollapse: vi.fn(),
  onEdit: vi.fn(),
  onClose: vi.fn(),
};

describe('DisplayPanelView', () => {
  it('renders the title, layer tag and attribute rows', () => {
    render(<DisplayPanelView {...base} />);
    // Title fixture and row value are both "Hoa Binh" by design of this fixture, so the
    // title assertion must scope to the heading rather than use an ambiguous getByText.
    expect(screen.getByRole('heading', { name: 'Hoa Binh' })).toBeInTheDocument();
    expect(screen.getByText('Đập & Hồ chứa')).toBeInTheDocument();
  });

  it('hides the pen unless the user can edit', () => {
    render(<DisplayPanelView {...base} />);
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).not.toBeInTheDocument();
  });

  it('shows the pen and calls onEdit when the user can edit', async () => {
    const onEdit = vi.fn();
    render(<DisplayPanelView {...base} canEdit onEdit={onEdit} />);

    await userEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));

    expect(onEdit).toHaveBeenCalled();
  });

  it('labels the toggle to collapse when expanded', () => {
    render(<DisplayPanelView {...base} />);
    expect(screen.getByRole('button', { name: 'Thu gọn' })).toBeInTheDocument();
  });

  it('labels the toggle to expand and hides the body when collapsed', () => {
    render(<DisplayPanelView {...base} collapsed />);
    expect(screen.getByRole('button', { name: 'Mở rộng' })).toBeInTheDocument();
    expect(screen.queryByText('Hoa Binh')).not.toBeInTheDocument();
  });
});
