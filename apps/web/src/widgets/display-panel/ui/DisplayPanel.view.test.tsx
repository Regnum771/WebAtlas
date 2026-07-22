import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayPanelView } from './DisplayPanel.view';

const base = {
  title: 'Hoa Binh',
  layerLabel: 'Đập & Hồ chứa',
  rows: [{ iso: 'geographicalName', label: 'name', value: 'Hoa Binh' }],
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
    // Hidden from the default (accessible) role query — this is what a screen reader
    // sees. getByRole excludes [hidden] subtrees by default, unlike getByText, so this
    // is the query that actually proves "not reachable by assistive tech".
    expect(screen.queryByRole('heading', { name: 'Hoa Binh' })).not.toBeInTheDocument();
  });

  it('keeps the panel mounted (not unmounted) while collapsed, only hidden', () => {
    const { container } = render(<DisplayPanelView {...base} collapsed />);
    // Querying the raw DOM (bypassing accessibility filtering) proves the subtree is
    // still mounted — a regression that unmounts on collapse would make this null too,
    // same as the accessible query above, so the two together distinguish
    // "mounted but hidden" from "unmounted".
    const aside = container.querySelector('.display-panel');
    expect(aside).not.toBeNull();
    expect(aside).toHaveAttribute('hidden');
    expect(aside?.querySelector('h2')?.textContent).toBe('Hoa Binh');
  });
});
