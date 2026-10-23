import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonalFeatureCardView } from './PersonalFeatureCard.view';

describe('PersonalFeatureCardView', () => {
  it('shows the layer title, one key: value row per property, and closes with Đóng', async () => {
    const onClose = vi.fn();
    render(
      <PersonalFeatureCardView
        title="Cống thoát nước"
        rows={[{ key: 'ten', value: 'Cống A' }, { key: 'ghi_chu', value: '—' }]}
        anchor={[340, 110]}
        canUseAsRoi
        onUseAsRoi={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Cống thoát nước' })).toBeInTheDocument();
    expect(screen.getByText('ten: Cống A')).toBeInTheDocument();
    expect(screen.getByText('ghi_chu: —')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Dùng làm vùng phân tích calls back for a usable geometry', async () => {
    const onUseAsRoi = vi.fn();
    render(<PersonalFeatureCardView title="Lớp" rows={[]} anchor={[1, 1]} canUseAsRoi onUseAsRoi={onUseAsRoi} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dùng làm vùng phân tích' }));
    expect(onUseAsRoi).toHaveBeenCalledTimes(1);
  });

  it('a MultiPolygon feature disables the button with the hint', () => {
    render(<PersonalFeatureCardView title="Lớp" rows={[]} anchor={[1, 1]} canUseAsRoi={false} onUseAsRoi={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dùng làm vùng phân tích' })).toBeDisabled();
    expect(screen.getByText('Đối tượng nhiều phần chưa dùng được làm vùng phân tích.')).toBeInTheDocument();
  });
});
