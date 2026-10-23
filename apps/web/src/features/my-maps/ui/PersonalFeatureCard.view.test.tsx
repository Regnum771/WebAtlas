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
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Cống thoát nước' })).toBeInTheDocument();
    expect(screen.getByText('ten: Cống A')).toBeInTheDocument();
    expect(screen.getByText('ghi_chu: —')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
