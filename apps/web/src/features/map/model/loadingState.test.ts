import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLoadTracker, LOADING_DELAY_MS } from './loadingState';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createLoadTracker', () => {
  it('stays silent for loads that finish quickly - the common case', () => {
    // A cached tile comes back in ~12ms. Flashing a bar on every pan would be
    // worse than showing nothing at all.
    const onBusy = vi.fn();
    const t = createLoadTracker(onBusy);
    t.start();
    vi.advanceTimersByTime(LOADING_DELAY_MS - 50);
    t.done();
    vi.advanceTimersByTime(1000);
    expect(onBusy).not.toHaveBeenCalled();
  });

  it('shows once loads are still outstanding past the delay', () => {
    const onBusy = vi.fn();
    const t = createLoadTracker(onBusy);
    t.start();
    vi.advanceTimersByTime(LOADING_DELAY_MS + 1);
    expect(onBusy).toHaveBeenLastCalledWith(true);
  });

  it('hides as soon as the last load finishes', () => {
    const onBusy = vi.fn();
    const t = createLoadTracker(onBusy);
    t.start(); t.start();
    vi.advanceTimersByTime(LOADING_DELAY_MS + 1);
    t.done();
    expect(onBusy).toHaveBeenLastCalledWith(true); // one still outstanding
    t.done();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it('never goes negative - a tile can error after its layer was removed', () => {
    // OL fires tileloadend/tileloaderror for requests already in flight when a
    // layer is torn down, so done() can outnumber start(). Going negative would
    // wedge the bar permanently off.
    const onBusy = vi.fn();
    const t = createLoadTracker(onBusy);
    t.done(); t.done();
    t.start();
    vi.advanceTimersByTime(LOADING_DELAY_MS + 1);
    expect(onBusy).toHaveBeenLastCalledWith(true);
  });

  it('reset clears a stuck count and cancels a pending show', () => {
    const onBusy = vi.fn();
    const t = createLoadTracker(onBusy);
    t.start();
    t.reset();
    vi.advanceTimersByTime(LOADING_DELAY_MS + 1);
    expect(onBusy).not.toHaveBeenCalledWith(true);
  });
});
