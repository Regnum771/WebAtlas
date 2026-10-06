import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantDockView } from './AssistantDock.view';

describe('AssistantDockView', () => {
  it('shows its content in a named landmark', () => {
    render(<AssistantDockView onClose={() => {}}><span>CHAT</span></AssistantDockView>);
    expect(within(screen.getByRole('complementary', { name: 'Trợ lý' })).getByText('CHAT')).toBeInTheDocument();
  });

  it('closes from its close button', async () => {
    const onClose = vi.fn();
    render(<AssistantDockView onClose={onClose}>x</AssistantDockView>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đóng trợ lý' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
