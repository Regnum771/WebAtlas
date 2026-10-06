import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Message } from './Message';

describe('Message', () => {
  it('an error is an alert with the error class', () => {
    render(
      <Message tone="error" title="Chưa tìm được">
        Máy chủ không phản hồi.
      </Message>,
    );
    expect(screen.getByRole('alert')).toHaveClass('msg', 'bad');
  });

  it.each(['info', 'caution', 'success'] as const)('%s is a status and is not red', (tone) => {
    render(<Message tone={tone} title="x" />);
    expect(screen.getByRole('status')).not.toHaveClass('bad');
  });

  it('renders title, body and actions', () => {
    render(
      <Message title="Tiêu đề" actions={<button type="button">Thử lại</button>}>
        Nội dung
      </Message>,
    );
    expect(screen.getByText('Tiêu đề').tagName).toBe('B');
    expect(screen.getByText('Nội dung').tagName).toBe('P');
    expect(screen.getByRole('button', { name: 'Thử lại' }).parentElement).toHaveClass('acts');
  });
});
