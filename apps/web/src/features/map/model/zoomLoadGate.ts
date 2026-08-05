/**
 * Cổng tải theo mức zoom.
 *
 * `setMinZoom` của OpenLayers chỉ chặn VẼ; source vẫn tự tải dữ liệu bất kể zoom.
 * Với các lớp nặng, ta cần chặn ở tầng SOURCE: chỉ nạp khi người dùng thực sự
 * phóng tới mức nhìn thấy lớp đó.
 *
 * Có hai kiểu cổng, dùng cho hai loại lớp khác nhau:
 *
 * - `createOneShotLoadGate` — lớp file tĩnh (ranh giới xã). Tải trọn vẹn ĐÚNG MỘT LẦN
 *   khi vượt ngưỡng, sau đó không cần gì thêm vì dữ liệu đã nằm hết trong bộ nhớ.
 *
 * - `createBboxLoadGate` — lớp WFS dùng chiến lược bbox (sông, hồ). Phải bật/tắt được
 *   NHIỀU LẦN: dưới ngưỡng thì xoá dữ liệu và ngừng tải để khỏi kéo về hàng chục MB;
 *   trên ngưỡng thì cho phép bbox hoạt động bình thường theo từng khung nhìn.
 */

/** Ngưỡng zoom hiển thị ranh giới xã — khớp với recomputeVisibility() trong MapModel. */
export const WARDS_MIN_ZOOM = 10.0;

/**
 * Ngưỡng zoom bắt đầu tải sông/hồ.
 *
 * Vì sao 8,5: vùng công tác rộng 374 km nhưng CAO 988 km, nên không có mức zoom nào
 * vừa trọn vùng vừa thu hẹp bbox. Ở khung nhìn lúc mở (zoom 7) bbox trải 101–116°Đ,
 * tức vẫn kéo về toàn bộ 17,6 MB dữ liệu sông. Từ 8,5 trở lên bbox mới thực sự cắt
 * bớt (≈6 MB và giảm nhanh khi phóng tiếp). Dưới ngưỡng, mạng lưới sông toàn vùng
 * cũng rối tới mức không đọc được, nên không mất mát gì về mặt thông tin.
 */
export const WATER_MIN_ZOOM = 8.5;

/**
 * Cổng một lần: gọi `load()` ở lần đầu zoom >= `minZoom`, sau đó không gọi lại nữa.
 * Trả về hàm nhận mức zoom, gọi mỗi lần `moveend`.
 */
export function createOneShotLoadGate(minZoom: number, load: () => void): (zoom: number) => void {
  let loaded = false;
  return (zoom: number) => {
    if (loaded) return;
    if (typeof zoom !== 'number' || Number.isNaN(zoom)) return;
    if (zoom < minZoom) return;
    loaded = true;
    load();
  };
}

/**
 * Cổng bật/tắt cho lớp WFS bbox: gọi `enable()` khi vượt lên ngưỡng và `disable()`
 * khi tụt xuống dưới, và CHỈ gọi khi trạng thái thực sự đổi (không gọi lại mỗi lần
 * `moveend` trong cùng một trạng thái).
 */
export function createBboxLoadGate(
  minZoom: number,
  enable: () => void,
  disable: () => void
): (zoom: number) => void {
  // `null` = chưa xác định, để lần gọi đầu tiên luôn kích hoạt đúng nhánh.
  let active: boolean | null = null;
  return (zoom: number) => {
    if (typeof zoom !== 'number' || Number.isNaN(zoom)) return;
    const shouldBeActive = zoom >= minZoom;
    if (shouldBeActive === active) return;
    active = shouldBeActive;
    if (shouldBeActive) enable();
    else disable();
  };
}
