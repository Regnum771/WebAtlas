import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayersPanelView } from './LayersPanel.view';

const groups = [
  {
    name: 'Tài nguyên nước',
    layers: [
      { id: 'layer_dams', name: 'Đập & Hồ chứa', visible: true, opacity: 1, gated: false },
      { id: 'layer_rivers', name: 'Sông ngòi', visible: true, opacity: 0.8, gated: true, gateHint: 'hiện từ mức 8,5' },
    ],
  },
];

describe('LayersPanelView', () => {
  it('shows the gate hint on a zoom-gated layer', () => {
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.getByText('hiện từ mức 8,5')).toBeInTheDocument();
  });

  it('calls onToggle with the layer id', async () => {
    const onToggle = vi.fn();
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={onToggle} onOpacity={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Đập & Hồ chứa/ }));
    expect(onToggle).toHaveBeenCalledWith('layer_dams');
  });

  it('renders the group heading', () => {
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Tài nguyên nước' })).toBeInTheDocument();
  });

  it('warns about catalog layers that have no display metadata', () => {
    render(
      <LayersPanelView
        groups={groups}
        missingDisplay={['layer_new_thing']}
        onToggle={vi.fn()}
        onOpacity={vi.fn()}
      />
    );
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('layer_new_thing');
    expect(warning).toHaveTextContent('chưa có mô tả hiển thị');
  });

  it('renders no warning when nothing is missing', () => {
    render(<LayersPanelView groups={groups} missingDisplay={[]} onToggle={vi.fn()} onOpacity={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
