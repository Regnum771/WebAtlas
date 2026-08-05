import { describe, it, expect, vi } from 'vitest';
import {
  createOneShotLoadGate,
  createBboxLoadGate,
  WARDS_MIN_ZOOM,
  WATER_MIN_ZOOM,
} from './zoomLoadGate';

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

describe('createBboxLoadGate', () => {
  it('tắt lớp khi mở ứng dụng dưới ngưỡng', () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const gate = createBboxLoadGate(WATER_MIN_ZOOM, enable, disable);
    gate(7);
    expect(disable).toHaveBeenCalledTimes(1);
    expect(enable).not.toHaveBeenCalled();
  });

  it('bật khi vượt lên ngưỡng', () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const gate = createBboxLoadGate(WATER_MIN_ZOOM, enable, disable);
    gate(7);
    gate(9);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it('KHÔNG gọi lại khi trạng thái không đổi (tránh gọi mỗi lần moveend)', () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const gate = createBboxLoadGate(WATER_MIN_ZOOM, enable, disable);
    gate(9);
    gate(9.5);
    gate(10);
    gate(11);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(disable).not.toHaveBeenCalled();
  });

  it('bật/tắt được NHIỀU LẦN khi ra vào ngưỡng (khác cổng một lần)', () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const gate = createBboxLoadGate(WATER_MIN_ZOOM, enable, disable);
    gate(9);   // bật
    gate(7);   // tắt
    gate(9);   // bật lại
    gate(7);   // tắt lại
    expect(enable).toHaveBeenCalledTimes(2);
    expect(disable).toHaveBeenCalledTimes(2);
  });

  it('bỏ qua mức zoom không xác định mà không đổi trạng thái', () => {
    const enable = vi.fn();
    const disable = vi.fn();
    const gate = createBboxLoadGate(WATER_MIN_ZOOM, enable, disable);
    gate(undefined as unknown as number);
    gate(NaN);
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it('ngưỡng nước thấp hơn ngưỡng xã (sông/hồ hiện trước ranh giới xã)', () => {
    expect(WATER_MIN_ZOOM).toBeLessThan(WARDS_MIN_ZOOM);
  });
});
