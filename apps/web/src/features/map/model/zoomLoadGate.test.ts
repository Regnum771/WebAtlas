import { describe, it, expect, vi } from 'vitest';
import {
  createOneShotLoadGate,
  createBboxLoadGate,
  createPendingRefreshQueue,
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

describe('createPendingRefreshQueue', () => {
  it('take() trả false cho lớp chưa từng ghi nhận', () => {
    const q = createPendingRefreshQueue();
    expect(q.take('layer_rivers')).toBe(false);
  });

  it('ghi nhận rồi lấy ra đúng một lần', () => {
    const q = createPendingRefreshQueue();
    q.add('layer_rivers');
    expect(q.take('layer_rivers')).toBe(true);
    expect(q.take('layer_rivers')).toBe(false); // đã lấy rồi thì thôi
  });

  it('ghi nhận trùng không làm phát sinh hai lần nạp bù', () => {
    const q = createPendingRefreshQueue();
    q.add('layer_rivers');
    q.add('layer_rivers');
    expect(q.size).toBe(1);
    expect(q.take('layer_rivers')).toBe(true);
    expect(q.take('layer_rivers')).toBe(false);
  });

  it('các lớp độc lập với nhau', () => {
    const q = createPendingRefreshQueue();
    q.add('layer_rivers');
    expect(q.take('layer_lakes')).toBe(false);
    expect(q.take('layer_rivers')).toBe(true);
  });

  it('clear() xoá sạch hàng đợi', () => {
    const q = createPendingRefreshQueue();
    q.add('layer_rivers');
    q.add('layer_lakes');
    q.clear();
    expect(q.size).toBe(0);
    expect(q.take('layer_rivers')).toBe(false);
  });
});

describe('kịch bản hồi quy: quản trị viên lưu đối tượng ở zoom thấp', () => {
  /**
   * Dựng lại đúng lỗi mà rà soát cuối phát hiện: sông/hồ là lớp CHO PHÉP SỬA.
   * Nếu lưu ở mức zoom dưới ngưỡng, source đang bị gỡ nên refresh() rơi vào hư không
   * và đối tượng vừa lưu KHÔNG hiện ra — trông y hệt lưu thất bại.
   */
  function makeMapStub() {
    const queue = createPendingRefreshQueue();
    const refreshed: string[] = [];
    // `null` nghĩa là source đang bị cổng gỡ ra.
    const sources: Record<string, { refresh: () => void } | null> = {
      layer_rivers: null,
      layer_lakes: null,
    };
    const attach = (id: string) => {
      sources[id] = { refresh: () => refreshed.push(id) };
    };
    const detach = (id: string) => {
      sources[id] = null;
    };
    const refreshLayer = (id: string) => {
      const src = sources[id];
      if (!src) {
        queue.add(id);
        return;
      }
      src.refresh();
    };
    const openGate = () => {
      for (const id of ['layer_rivers', 'layer_lakes']) {
        attach(id);
        if (queue.take(id)) sources[id]!.refresh();
      }
    };
    return { queue, refreshed, refreshLayer, openGate, detach };
  }

  it('lưu khi cổng ĐANG ĐÓNG thì được nạp bù lúc cổng mở', () => {
    const m = makeMapStub();
    m.refreshLayer('layer_rivers'); // quản trị viên lưu ở zoom 8 (dưới ngưỡng)
    expect(m.refreshed).toEqual([]); // chưa nạp được gì — đúng như hiện trạng
    m.openGate();                    // người dùng phóng qua 8,5
    expect(m.refreshed).toContain('layer_rivers'); // ĐÃ nạp bù
  });

  it('không nạp bù cho lớp không có yêu cầu nào', () => {
    const m = makeMapStub();
    m.refreshLayer('layer_rivers');
    m.openGate();
    expect(m.refreshed).toEqual(['layer_rivers']); // KHÔNG kèm layer_lakes
  });

  it('lưu khi cổng ĐANG MỞ thì nạp ngay, không qua hàng đợi', () => {
    const m = makeMapStub();
    m.openGate();
    m.refreshed.length = 0;
    m.refreshLayer('layer_lakes');
    expect(m.refreshed).toEqual(['layer_lakes']);
    expect(m.queue.size).toBe(0);
  });

  it('mở cổng lần hai không nạp lại yêu cầu đã xử lý', () => {
    const m = makeMapStub();
    m.refreshLayer('layer_rivers');
    m.openGate();
    m.refreshed.length = 0;
    m.detach('layer_rivers');
    m.detach('layer_lakes');
    m.openGate();
    expect(m.refreshed).toEqual([]); // hàng đợi đã rỗng
  });
});
