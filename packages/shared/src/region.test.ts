import { describe, it, expect } from 'vitest';
import { REGION_PROVINCE_CODES, REGION_NAME, isRegionProvince } from './region';

describe('region', () => {
  it('gồm đúng 6 tỉnh của vùng Nam Trung Bộ & Tây Nguyên', () => {
    expect(REGION_PROVINCE_CODES).toHaveLength(6);
    expect([...REGION_PROVINCE_CODES].sort()).toEqual(['48', '51', '52', '56', '66', '68']);
  });

  it('mã tỉnh là chuỗi hai ký tự số, giữ số 0 đứng đầu', () => {
    for (const code of REGION_PROVINCE_CODES) {
      expect(code).toMatch(/^\d{2}$/);
    }
  });

  it('isRegionProvince nhận diện đúng trong/ngoài vùng', () => {
    expect(isRegionProvince('48')).toBe(true);
    expect(isRegionProvince('68')).toBe(true);
    expect(isRegionProvince('01')).toBe(false); // Hà Nội
    expect(isRegionProvince('79')).toBe(false); // TP.HCM
  });

  it('isRegionProvince không vỡ với giá trị lạ', () => {
    expect(isRegionProvince(null)).toBe(false);
    expect(isRegionProvince(undefined)).toBe(false);
    expect(isRegionProvince(48)).toBe(false); // số, không phải chuỗi
    expect(isRegionProvince('')).toBe(false);
  });

  it('có tên vùng hiển thị được', () => {
    expect(REGION_NAME).toBe('Nam Trung Bộ & Tây Nguyên');
  });
});
