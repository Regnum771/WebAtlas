import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspacePanelView } from './WorkspacePanel.view';

describe('WorkspacePanelView', () => {
  it('renders title + children when open', () => {
    render(<WorkspacePanelView open title="Data Steward" onClose={vi.fn()}><div>panel body</div></WorkspacePanelView>);
    expect(screen.getByText('Data Steward')).toBeInTheDocument();
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<WorkspacePanelView open={false} title="X" onClose={vi.fn()}><div>hidden</div></WorkspacePanelView>);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<WorkspacePanelView open title="X" onClose={onClose}><div>b</div></WorkspacePanelView>);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
