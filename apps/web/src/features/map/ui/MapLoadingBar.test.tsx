import { describe, it, expect } from 'vitest';
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
