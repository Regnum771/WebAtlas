import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditDrawerView } from './EditDrawer.view';

describe('EditDrawerView', () => {
  it('renders children when open', () => {
    render(<EditDrawerView open onClose={vi.fn()}><div>drawer body</div></EditDrawerView>);
    expect(screen.getByText('drawer body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <EditDrawerView open={false} onClose={vi.fn()}><div>hidden</div></EditDrawerView>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<EditDrawerView open onClose={onClose}><div>b</div></EditDrawerView>);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
