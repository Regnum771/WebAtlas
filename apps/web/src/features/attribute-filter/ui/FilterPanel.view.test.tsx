import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterPanelView } from './FilterPanel.view';

const baseProps = {
  layerKey: 'dams' as const,
  fields: [
    { iso: 'statusSlug', label: 'Trạng thái', type: 'enum' as const, enumValues: ['xa_lu', 'binh_thuong'] },
    { iso: 'ratedPower', label: 'Công suất (MW)', type: 'number' as const },
  ],
  conditions: [{ field: 'statusSlug', op: 'eq' as const, value: 'xa_lu' }],
  results: [{ id: '0', label: 'Đập A', subLabel: '250', hasGeometry: true }],
  count: 1,
  layerLoaded: true,
  onSelectLayer: vi.fn(),
  onAddCondition: vi.fn(),
  onUpdateCondition: vi.fn(),
  onRemoveCondition: vi.fn(),
  onClear: vi.fn(),
  onEnableLayer: vi.fn(),
  onResultClick: vi.fn(),
};

describe('FilterPanelView', () => {
  it('renders the result count and a result row', () => {
    render(<FilterPanelView {...baseProps} />);
    expect(screen.getByText(/1 kết quả/i)).toBeInTheDocument();
    expect(screen.getByText('Đập A')).toBeInTheDocument();
  });

  it('clicking a result calls onResultClick with its id', async () => {
    render(<FilterPanelView {...baseProps} />);
    await userEvent.click(screen.getByText('Đập A'));
    expect(baseProps.onResultClick).toHaveBeenCalledWith('0');
  });

  it('shows an enable prompt when the layer is not loaded', () => {
    render(<FilterPanelView {...baseProps} layerLoaded={false} results={[]} count={0} />);
    expect(screen.getByRole('button', { name: /bật lớp/i })).toBeInTheDocument();
  });

  it('clicking "Xóa lọc" calls onClear', async () => {
    render(<FilterPanelView {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: /xóa lọc/i }));
    expect(baseProps.onClear).toHaveBeenCalled();
  });
});
