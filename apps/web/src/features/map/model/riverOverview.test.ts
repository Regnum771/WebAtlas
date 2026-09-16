import { describe, it, expect } from 'vitest';
import { riverOverviewVisibleAt, RIVER_OVERVIEW_MAX_ZOOM } from './riverOverview';
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';
import { MIN_ZOOM } from './zoomScale';

describe('riverOverviewVisibleAt', () => {
  it('hands over exactly where the full layer takes over', () => {
    // The two layers must never both draw: bucket 3 would render twice at two
    // different simplifications, which reads as a doubled river.
    expect(RIVER_OVERVIEW_MAX_ZOOM).toBe(LAYER_DISPLAY.layer_rivers.minZoom);
  });

  it('covers the zoomed-out half, which had no rivers at all', () => {
    expect(riverOverviewVisibleAt(MIN_ZOOM)).toBe(true);
    expect(riverOverviewVisibleAt(7)).toBe(true);
    expect(riverOverviewVisibleAt(8.4)).toBe(true);
  });

  it('yields to the full layer at and above its gate', () => {
    expect(riverOverviewVisibleAt(8.5)).toBe(false);
    expect(riverOverviewVisibleAt(12)).toBe(false);
  });
});
