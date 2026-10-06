import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapToolbarView } from './MapToolbar';

const baseProps = {
  measureMode: 'none' as const,
  measureValue: null,
  onMeasure: vi.fn(),
  onBasemap: vi.fn(),
};

describe('MapToolbarView', () => {
  it('shows the measurement readout when there is a value', () => {
    render(<MapToolbarView {...baseProps} measureMode="length" measureValue="42,3 km" />);
    expect(screen.getByText('42,3 km')).toBeInTheDocument();
  });

  it('marks the active measure tool as pressed', () => {
    render(<MapToolbarView {...baseProps} measureMode="area" />);
    expect(screen.getByRole('button', { name: /Đo diện tích/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('still reports every existing action after the layout change', async () => {
    const onMeasure = vi.fn();
    const onBasemap = vi.fn();
    render(
      <MapToolbarView
        {...baseProps}
        onMeasure={onMeasure}
        onBasemap={onBasemap}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Đo chiều dài (sông)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vệ tinh' }));
    expect(onMeasure).toHaveBeenCalledWith('length');
    expect(onBasemap).toHaveBeenCalledWith('satellite');
  });

  it('renders the analysis slots when provided', () => {
    render(<MapToolbarView {...baseProps} analysisButtons={<button>Vùng đệm</button>} analysisPanel={<p>panel</p>} />);
    expect(screen.getByRole('button', { name: 'Vùng đệm' })).toBeInTheDocument();
    expect(screen.getByText('panel')).toBeInTheDocument();
  });

  it('labels the measure buttons as the Đo nhanh group', () => {
    render(<MapToolbarView {...baseProps} />);
    const group = screen.getByRole('group', { name: 'Đo nhanh' });
    expect(within(group).getByRole('button', { name: /Đo chiều dài/ })).toBeInTheDocument();
  });
});
