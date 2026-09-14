import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Search from './index';
import * as api from './api/search.api';

// Search dispatches zoomToFeature through the real createCommandExecutor with
// map: null, which just returns { ok: false, ... } harmlessly — no OL needed.
vi.mock('../../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    map: null,
    setBasemap: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
    layersState: [],
  }),
}));

const hits = [
  { layerKey: 'lakes' as const, featureId: 'l1', name: 'Hồ Lắk', lonLat: [108.2, 12.4] as [number, number] },
];

describe('Search (feature slice)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('clears the query and hides the dropdown after selecting a result', async () => {
    vi.spyOn(api, 'fetchSearch').mockResolvedValue(hits);
    render(<Search />);

    const input = screen.getByPlaceholderText('Tìm kiếm đối tượng…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'la' } });
    await act(async () => { vi.advanceTimersByTime(500); });
    await waitFor(() => expect(screen.getByText(/Hồ Lắk/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Hồ Lắk/));

    expect(input.value).toBe('');
    expect(screen.queryByText(/Hồ Lắk/)).not.toBeInTheDocument();
  });
});
