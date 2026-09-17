import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Search from './index';
import * as api from './api/search.api';

// Search dispatches commands through the real createCommandExecutor. The fake
// map only needs getView().animate — that's the one real (unmocked) side effect
// createCommandExecutor produces (zoomToFeature, the geometry-fetch fallback).
// showGeometries's own map work goes through showResults, which is mocked below,
// so the fake map never needs to behave like a real OL Map for that path.
const animate = vi.fn();
vi.mock('../../app/providers/MapProvider', () => ({
  useMapContext: () => ({
    map: { getView: () => ({ animate }) },
    setBasemap: vi.fn(),
    toggleLayerVisibility: vi.fn(),
    setLayerOpacity: vi.fn(),
    layersState: [],
  }),
}));

const fetchFeatureGeometry = vi.fn();
vi.mock('./api/search.api', async (orig) => ({
  ...(await orig<typeof import('./api/search.api')>()),
  fetchFeatureGeometry: (...args: unknown[]) => fetchFeatureGeometry(...args),
}));

const showResults = vi.fn();
vi.mock('../map/model/highlightLayer', async (orig) => ({
  ...(await orig<typeof import('../map/model/highlightLayer')>()),
  showResults: (...args: unknown[]) => showResults(...args),
}));

const hits = [
  { layerKey: 'lakes' as const, featureId: 'l1', name: 'Hồ Lắk', lonLat: [108.2, 12.4] as [number, number] },
];

async function renderAndSelectFirstHit() {
  vi.spyOn(api, 'fetchSearch').mockResolvedValue(hits);
  render(<Search />);

  const input = screen.getByPlaceholderText('Tìm kiếm đối tượng…') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'la' } });
  await act(async () => { vi.advanceTimersByTime(500); });
  await waitFor(() => expect(screen.getByText(/Hồ Lắk/)).toBeInTheDocument());

  fireEvent.click(screen.getByText(/Hồ Lắk/));
  return input;
}

describe('Search (feature slice)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchFeatureGeometry.mockReset();
    showResults.mockReset();
    animate.mockReset();
    // Sane default so tests that don't care about the geometry fetch (e.g. the
    // clear-on-select test below) don't crash on `.then` of an undefined return.
    fetchFeatureGeometry.mockResolvedValue({ name: null, geometry: { type: 'Point', coordinates: [0, 0] } });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('clears the query and hides the dropdown after selecting a result', async () => {
    const input = await renderAndSelectFirstHit();

    expect(input.value).toBe('');
    expect(screen.queryByText(/Hồ Lắk/)).not.toBeInTheDocument();
  });

  it('draws and frames the whole geometry of the selected hit', async () => {
    fetchFeatureGeometry.mockResolvedValue({
      name: 'Sông Ba',
      geometry: { type: 'LineString', coordinates: [[108, 13], [108.5, 13.4]] },
    });
    await renderAndSelectFirstHit();
    await vi.waitFor(() => expect(showResults).toHaveBeenCalledTimes(1));
    const [, items, fit] = showResults.mock.calls[0];
    expect(items[0]).toMatchObject({ role: 'highlight', label: 'Sông Ba' });
    expect(fit).toBe(true);
  });

  it('falls back to zooming to the point when the geometry request fails', async () => {
    fetchFeatureGeometry.mockRejectedValue(new Error('offline'));
    await renderAndSelectFirstHit();
    await vi.waitFor(() => expect(animate).toHaveBeenCalled());
    expect(showResults).not.toHaveBeenCalled();
  });
});
