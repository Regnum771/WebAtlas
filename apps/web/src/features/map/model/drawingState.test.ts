import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DRAW_GRACE_MS, claimDrawing, drawingJustEnded, getDrawFeedback, isDrawing, releaseDrawing, resetDrawing, setDrawFeedback } from './drawingState';

beforeEach(() => { resetDrawing(); });

describe('drawingState', () => {
  it('tracks who is drawing', () => {
    expect(isDrawing()).toBe(false);
    claimDrawing('roi');
    expect(isDrawing()).toBe(true);
    expect(getDrawFeedback().owner).toBe('roi');
  });

  it('a hand-over is not undone by the previous owner releasing late', () => {
    claimDrawing('roi');
    claimDrawing('ruler');
    releaseDrawing('roi');
    expect(getDrawFeedback().owner).toBe('ruler');
  });

  it('carries the aids’ hint and live measure, reset on each claim', () => {
    claimDrawing('roi');
    setDrawFeedback({ hint: 'Nhấp để khép vùng', measure: '3,2 km²' });
    expect(getDrawFeedback()).toMatchObject({ hint: 'Nhấp để khép vùng', measure: '3,2 km²' });
    claimDrawing('ruler');
    expect(getDrawFeedback()).toMatchObject({ hint: null, measure: null });
  });
});

describe('drawingJustEnded', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('is true right after a release and false once the grace window has passed', () => {
    claimDrawing('roi');
    releaseDrawing('roi');
    expect(drawingJustEnded()).toBe(true);
    vi.advanceTimersByTime(DRAW_GRACE_MS);
    expect(drawingJustEnded()).toBe(false);
  });

  it('ignores a release by a non-owner', () => {
    vi.advanceTimersByTime(DRAW_GRACE_MS * 2);
    claimDrawing('roi');
    releaseDrawing('ruler');
    expect(drawingJustEnded()).toBe(false);
  });
});
