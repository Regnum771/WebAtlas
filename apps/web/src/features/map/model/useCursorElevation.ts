import { useEffect, useRef, useState } from 'react';
import type { Map as OlMap } from 'ol';
import { toLonLat } from 'ol/proj';
import { fetchElevation } from '../api/elevation.api';

/**
 * Độ cao tại vị trí con trỏ, cho ô đọc số góc dưới phải.
 *
 * Vì sao phải hỏi máy chủ: DEM nằm trong PostGIS (basemap.dem_region), trình duyệt không
 * giữ bản sao nào. Vì sao KHÔNG hỏi mỗi lần chuột nhúc nhích: hạn mức chung của API là
 * 100 yêu cầu/phút (plugins/security.ts) — một người chỉ rê chuột cũng đủ làm cạn hạn
 * mức đó rồi bị chặn ở MỌI tuyến khác. Ba lớp chặn dưới đây giữ lưu lượng ở mức thấp,
 * và tuyến /api/elevation còn có trần riêng 600/phút để sự cố đó không lan ra.
 */

/** Chờ con trỏ ĐỨNG YÊN bao lâu rồi mới hỏi. 250 ms: đủ ngắn để cảm giác tức thì, đủ dài
 *  để một cú rê chuột ngang bản đồ chỉ tốn một yêu cầu chứ không phải hàng trăm. */
export const SETTLE_MS = 250;

/** Bộ nhớ đệm theo toạ độ đã làm tròn. 4 chữ số ~ 11 m, mịn hơn ô lưới DEM 30 m nhiều,
 *  nên làm tròn ở mức này không hề làm kết quả kém chính xác — chỉ gộp những lần hỏi
 *  trùng nhau trong cùng một ô lưới. */
const CACHE_DECIMALS = 4;
/** Trần bộ nhớ đệm. Rê chuột lâu sinh ra rất nhiều khoá; quá số này thì xoá sạch, vì một
 *  phiên xem bản đồ không cần lịch sử vô hạn và LRU đầy đủ là thừa cho việc này. */
const CACHE_MAX = 500;

export function elevationCacheKey(lon: number, lat: number): string {
  return `${lon.toFixed(CACHE_DECIMALS)},${lat.toFixed(CACHE_DECIMALS)}`;
}

export interface CursorElevation {
  /** Mét trên mực nước biển, hoặc null khi chưa có/không có số liệu. */
  elevationM: number | null;
  /** Đang chờ máy chủ trả lời cho vị trí hiện tại. */
  pending: boolean;
  /** Máy chủ này chưa nạp DEM — ô đọc số sẽ tự ẩn hẳn thay vì hiện "—" mãi mãi. */
  unavailable: boolean;
}

export function useCursorElevation(map: OlMap | null): CursorElevation {
  const [state, setState] = useState<CursorElevation>({ elevationM: null, pending: false, unavailable: false });
  const cache = useRef(new Map<string, number | null>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  // Một khi máy chủ báo chưa nạp DEM thì không hỏi lại nữa trong phiên này: câu trả lời
  // không thể đổi giữa chừng, và hỏi tiếp chỉ tốn yêu cầu để nhận cùng một chữ "không".
  const gaveUp = useRef(false);

  useEffect(() => {
    if (!map) return;

    const onMove = (evt: { coordinate: number[]; dragging?: boolean }) => {
      // Đang kéo bản đồ thì toạ độ dưới con trỏ là của cảnh đang trôi, không phải điều
      // người dùng muốn đọc — và mỗi khung hình lại sinh một lần hỏi.
      if (evt.dragging || gaveUp.current) return;

      const [lon, lat] = toLonLat(evt.coordinate);
      const key = elevationCacheKey(lon, lat);

      if (timer.current) clearTimeout(timer.current);

      if (cache.current.has(key)) {
        // Đã biết rồi thì trả lời ngay, và huỷ luôn lần hỏi đang bay (nếu có) vì nó là
        // của vị trí cũ: để nó chạy tiếp thì kết quả cũ có thể về SAU và ghi đè.
        inflight.current?.abort();
        inflight.current = null;
        setState({ elevationM: cache.current.get(key) ?? null, pending: false, unavailable: false });
        return;
      }

      setState((prev) => ({ ...prev, pending: true }));
      timer.current = setTimeout(async () => {
        inflight.current?.abort();
        const controller = new AbortController();
        inflight.current = controller;
        try {
          const res = await fetchElevation(lon, lat, controller.signal);
          if (controller.signal.aborted) return;
          if (res.status === 'unavailable') {
            gaveUp.current = true;
            setState({ elevationM: null, pending: false, unavailable: true });
            return;
          }
          if (cache.current.size >= CACHE_MAX) cache.current.clear();
          cache.current.set(key, res.elevationM);
          setState({ elevationM: res.elevationM, pending: false, unavailable: false });
        } catch {
          // Mạng lỗi hoặc yêu cầu bị huỷ: ô đọc số chỉ việc im lặng. Đây là thông tin
          // phụ trợ, không đáng để dựng một thông báo lỗi trên bản đồ.
          if (!controller.signal.aborted) setState({ elevationM: null, pending: false, unavailable: false });
        }
      }, SETTLE_MS);
    };

    map.on('pointermove', onMove as never);
    return () => {
      map.un('pointermove', onMove as never);
      if (timer.current) clearTimeout(timer.current);
      inflight.current?.abort();
    };
  }, [map]);

  return state;
}
