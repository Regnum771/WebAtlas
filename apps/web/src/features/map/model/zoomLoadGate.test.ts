import { describe, it, expect, vi } from 'vitest';
import { createOneShotLoadGate, WARDS_MIN_ZOOM, WATER_MIN_ZOOM } from './zoomLoadGate';

describe('createOneShotLoadGate', () => {
  it('chưa tải khi còn dưới ngưỡng', () => {
    const load = vi.fn();
    const gate = createOneShotLoadGate(WARDS_MIN_ZOOM, load);
    gate(7);
    gate(9.9);
    expect(load).not.toHaveBeenCalled();
  });

  it('tải khi chạm đúng ngưỡng', () => {
    const load = vi.fn();
    const gate = createOneShotLoadGate(WARDS_MIN_ZOOM, load);
    gate(WARDS_MIN_ZOOM);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('chỉ tải đúng một lần dù ra vào ngưỡng nhiều lần', () => {
    const load = vi.fn();
    const gate = createOneShotLoadGate(WARDS_MIN_ZOOM, load);
    gate(10.5);
    gate(7);
    gate(11);
    gate(8);
    gate(12);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua mức zoom không xác định', () => {
    const load = vi.fn();
    const gate = createOneShotLoadGate(WARDS_MIN_ZOOM, load);
    gate(undefined as unknown as number);
    gate(NaN);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('WATER_MIN_ZOOM', () => {
  it('ngưỡng nước thấp hơn ngưỡng xã (sông/hồ hiện trước ranh giới xã)', () => {
    expect(WATER_MIN_ZOOM).toBeLessThan(WARDS_MIN_ZOOM);
  });
});
