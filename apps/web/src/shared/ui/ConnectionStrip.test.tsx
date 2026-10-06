import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionStrip } from './ConnectionStrip';

function setOnline(value: boolean) {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}
afterEach(() => { vi.restoreAllMocks(); });

describe('ConnectionStrip', () => {
  it('renders nothing while online', () => {
    setOnline(true);
    const { container } = render(<ConnectionStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows at once when the page loads offline', () => {
    setOnline(false);
    render(<ConnectionStrip />);
    expect(screen.getByRole('status')).toHaveTextContent('Mất kết nối. Dữ liệu sẽ tải lại khi có mạng.');
  });

  it('shows on an offline event and goes on an online event', () => {
    setOnline(true);
    render(<ConnectionStrip />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { setOnline(false); window.dispatchEvent(new Event('offline')); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { setOnline(true); window.dispatchEvent(new Event('online')); });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
