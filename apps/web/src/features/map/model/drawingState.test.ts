import { describe, it, expect, beforeEach } from 'vitest';
import { claimDrawing, getDrawFeedback, isDrawing, releaseDrawing, setDrawFeedback } from './drawingState';

beforeEach(() => { releaseDrawing('roi'); releaseDrawing('ruler'); });

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
