import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLoadingBarView } from './MapLoadingBar';

describe('MapLoadingBarView', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<MapLoadingBarView busy={false} flyoutOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an indeterminate progressbar when busy', () => {
    render(<MapLoadingBarView busy flyoutOpen={false} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('does not carry the flyout-open class when the flyout is closed', () => {
    const { container } = render(<MapLoadingBarView busy flyoutOpen={false} />);
    expect(container.querySelector('.map-loading-bar')).not.toHaveClass('flyout-open');
  });

  it('tracks the flyout-open class to the prop', () => {
    const { container } = render(<MapLoadingBarView busy flyoutOpen />);
    expect(container.querySelector('.map-loading-bar')).toHaveClass('flyout-open');
  });
});

// Container: đọc `busy` từ useMapContext() (MapView đăng ký state đó qua
// model.setLoadingListener(setBusy) — xem MapView.test.tsx) rồi chuyển tiếp
// cùng flyoutOpen xuống MapLoadingBarView. Trước bản sửa này chỉ MapLoadingBarView
// (view thụ động) được test; container — phần thật sự nối vào MapProvider — thì
// không có test nào, nên đọc sai/đọc thiếu field `busy` sẽ không bị phát hiện.
let mockBusy = false;
vi.mock('../../../app/providers/MapProvider', () => ({
  useMapContext: () => ({ busy: mockBusy }),
}));

import MapLoadingBar from './MapLoadingBar';

describe('MapLoadingBar (container)', () => {
  beforeEach(() => {
    mockBusy = false;
  });

  it('renders nothing when MapProvider reports idle', () => {
    const { container } = render(<MapLoadingBar flyoutOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the progressbar when MapProvider reports busy', () => {
    mockBusy = true;
    render(<MapLoadingBar flyoutOpen={false} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('forwards flyoutOpen through to the flyout-open class', () => {
    mockBusy = true;
    const { container } = render(<MapLoadingBar flyoutOpen />);
    expect(container.querySelector('.map-loading-bar')).toHaveClass('flyout-open');
  });
});
