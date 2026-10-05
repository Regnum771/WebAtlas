import { describe, it, expect } from 'vitest';
import { WARDS_MIN_ZOOM, WATER_MIN_ZOOM } from './zoomLoadGate';

describe('WATER_MIN_ZOOM', () => {
  it('ngưỡng nước thấp hơn ngưỡng xã (sông/hồ hiện trước ranh giới xã)', () => {
    expect(WATER_MIN_ZOOM).toBeLessThan(WARDS_MIN_ZOOM);
  });
});
