import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLoadingBarView } from './MapLoadingBar';

describe('MapLoadingBarView', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<MapLoadingBarView busy={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an indeterminate progressbar when busy', () => {
    render(<MapLoadingBarView busy />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

// Container: reads `busy` from useMapContext() (MapView registers that state via
// model.setLoadingListener(setBusy), see MapView.test.tsx) and passes it to
// MapLoadingBarView. Without this block only the passive view was tested, so a
// misread `busy` field in the container would go unnoticed.
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
    const { container } = render(<MapLoadingBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the progressbar when MapProvider reports busy', () => {
    mockBusy = true;
    render(<MapLoadingBar />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
