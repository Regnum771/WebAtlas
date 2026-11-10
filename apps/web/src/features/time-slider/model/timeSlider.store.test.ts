import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTimeSlider, pause, play, resetTimeSlider, setSpeed, setSteps, setStepsFor, setTime, stepBy } from './timeSlider.store';

const S = ['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z', '2025-10-26T02:00:00Z'];

describe('timeSlider.store', () => {
  beforeEach(() => { vi.useFakeTimers(); resetTimeSlider(); });
  afterEach(() => { resetTimeSlider(); vi.useRealTimers(); });

  it('starts on the first step and keeps the time while it stays in range', () => {
    setSteps(S);
    expect(getTimeSlider().time).toBe(S[0]);
    setTime(S[1]);
    setSteps([...S, '2025-10-26T03:00:00Z']);
    expect(getTimeSlider().time).toBe(S[1]);
    setSteps(['2025-10-27T00:00:00Z', '2025-10-27T01:00:00Z']);
    expect(getTimeSlider().time).toBe('2025-10-27T00:00:00Z');
    setSteps([]);
    expect(getTimeSlider().time).toBeNull();
  });

  it('each source supplies its own steps; the slider runs over their union', () => {
    setStepsFor('catalogue', [S[0], S[2]]);
    setStepsFor('personal', [S[1]]);
    expect(getTimeSlider().steps).toEqual(S);
    // One source clearing its steps leaves the other's.
    setStepsFor('catalogue', []);
    expect(getTimeSlider().steps).toEqual([S[1]]);
    setStepsFor('personal', []);
    expect(getTimeSlider().steps).toEqual([]);
  });

  it('stepBy moves along the steps and clamps', () => {
    setSteps(S);
    stepBy(1);
    expect(getTimeSlider().time).toBe(S[1]);
    stepBy(10);
    expect(getTimeSlider().time).toBe(S[2]);
    stepBy(-10);
    expect(getTimeSlider().time).toBe(S[0]);
  });

  it('play advances one step per 1000 / speed ms and stops at the last step', () => {
    setSteps(S);
    play();
    expect(getTimeSlider().playing).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(getTimeSlider().time).toBe(S[1]);
    vi.advanceTimersByTime(1000);
    expect(getTimeSlider().time).toBe(S[2]);
    expect(getTimeSlider().playing).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(getTimeSlider().time).toBe(S[2]);
  });

  it('speed changes the interval, pause stops it', () => {
    setSteps(S);
    setSpeed(4);
    play();
    vi.advanceTimersByTime(250);
    expect(getTimeSlider().time).toBe(S[1]);
    pause();
    vi.advanceTimersByTime(2000);
    expect(getTimeSlider().time).toBe(S[1]);
    expect(getTimeSlider().playing).toBe(false);
  });
});
