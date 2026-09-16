/**
 * Quy đổi giữa mức zoom Web Mercator và tỷ lệ bản đồ (scale denominator).
 *
 * Công thức chuẩn OGC: scale = resolution * (DPI / 0.0254), trong đó
 * resolution (m/px) = (2 * PI * R / 256) / 2^zoom * cos(latitude).
 *
 * Tỷ lệ phụ thuộc vĩ độ, nên mọi con số ở đây quy chiếu về REFERENCE_LATITUDE
 * (~16°N, giữa Việt Nam) để một mức zoom luôn ứng với một tỷ lệ ổn định.
 */

/** Bán kính Trái Đất theo WGS84 (m). */
const EARTH_RADIUS_M = 6378137;
/** DPI quy ước của màn hình theo OGC. */
const SCREEN_DPI = 96;
const INCH_M = 0.0254;

/** Vĩ độ quy chiếu để tính tỷ lệ — giữa Việt Nam. */
export const REFERENCE_LATITUDE = 16;

/** Độ phân giải (m/px) tại mức zoom, ở vĩ độ cho trước. */
export function resolutionAtZoom(zoom: number, latitude = REFERENCE_LATITUDE): number {
  return (
    ((2 * Math.PI * EARTH_RADIUS_M) / 256 / Math.pow(2, zoom)) *
    Math.cos((latitude * Math.PI) / 180)
  );
}

/** Mẫu số tỷ lệ bản đồ tại mức zoom (vd. 100000 nghĩa là 1:100.000). */
export function scaleAtZoom(zoom: number, latitude = REFERENCE_LATITUDE): number {
  return resolutionAtZoom(zoom, latitude) * (SCREEN_DPI / INCH_M);
}

/** Mức zoom ứng với một mẫu số tỷ lệ (nghịch đảo của scaleAtZoom). */
export function zoomForScale(scale: number, latitude = REFERENCE_LATITUDE): number {
  const resolution = scale / (SCREEN_DPI / INCH_M);
  return Math.log2(((2 * Math.PI * EARTH_RADIUS_M) / 256) * Math.cos((latitude * Math.PI) / 180) / resolution);
}

/**
 * Thu nhỏ hết cỡ: 1:12.800.000 — trọn VIETNAM_EXTENT_4326 (~1.725 km Bắc–Nam)
 * lọt vào khung nhìn cao ~900 px (chiếm 509 px), còn dư nhiều lề.
 *
 * VÌ SAO ĐÚNG CON SỐ NÀY, KHÔNG PHẢI 7.500.000 NHƯ TRƯỚC: ol/View tính
 *   maxZoom = minZoom + floor(log2(maxResolution / minResolution))
 * nên khoảng thu phóng bị CẮT XUỐNG số nguyên mức zoom gần nhất. Cặp cũ
 * 7.500.000 -> 100.000 rộng log2(75) = 6,2289 mức, bị cắt còn 6, khiến bản đồ
 * dừng ở 1:117.188 chứ không bao giờ tới được 1:100.000 mà hằng số quảng cáo.
 *
 * Cặp hiện tại rộng ĐÚNG 9 mức (12.800.000 / 25.000 = 512 = 2^9) nên không có
 * gì bị cắt. Muốn đổi giới hạn thì tỷ số MIN_SCALE/MAX_SCALE phải là luỹ thừa
 * của 2 — có một ca kiểm thử giữ điều kiện đó. Lưu ý DPI và vĩ độ KHÔNG giúp
 * được gì ở đây: chúng triệt tiêu khỏi tỷ số.
 */
export const MIN_SCALE = 12_800_000;
/** Phóng to hết cỡ: 1:25.000. Xem MIN_SCALE về ràng buộc luỹ thừa của 2. */
export const MAX_SCALE = 25_000;

export const MIN_ZOOM = zoomForScale(MIN_SCALE);
export const MAX_ZOOM = zoomForScale(MAX_SCALE);

/** Bao toàn bộ lãnh thổ đất liền Việt Nam (lon/lat, EPSG:4326). */
export const VIETNAM_EXTENT_4326: [number, number, number, number] = [102.0, 8.0, 110.0, 23.5];

/** Tâm mặc định khi bấm "về toàn cảnh" (lon/lat). */
export const VIETNAM_CENTER_4326: [number, number] = [106.5, 16.0];

/**
 * Khung nhìn KHI MỞ ỨNG DỤNG — vùng công tác (Nam Trung Bộ & Tây Nguyên),
 * phần ĐẤT LIỀN: 107,2–110,6°Đ / 7,3–16,2°B, tức 374 x 988 km.
 * (Bỏ Hoàng Sa/Trường Sa: tuy thuộc Đà Nẵng/Khánh Hòa nhưng nằm xa ngoài khơi,
 * lấy vào sẽ đẩy tâm bản đồ ra giữa Biển Đông.)
 *
 * Vì sao mở ở đây thay vì toàn quốc: dữ liệu chuyên đề chỉ tồn tại trong vùng
 * công tác, nên mở ở mức toàn quốc vừa hiển thị vùng trống mênh mông vừa buộc
 * chiến lược bbox phải tải TOÀN BỘ dữ liệu ngay từ đầu (khung nhìn ở MIN_ZOOM
 * rộng 2.172 km, bao trọn Việt Nam). Mở đúng vùng công tác giúp bbox chỉ tải
 * phần thực sự nhìn thấy.
 *
 * Đây KHÔNG phải giới hạn: người dùng vẫn thu nhỏ được tới MIN_ZOOM để xem cả nước.
 */
export const INITIAL_CENTER_4326: [number, number] = [108.93, 11.77];

/** Mức zoom khi mở ứng dụng — vừa đủ trọn chiều Bắc–Nam của vùng công tác. */
export const INITIAL_ZOOM = 7;

/** Định dạng mẫu số tỷ lệ thành nhãn "1:100.000" (dấu chấm ngăn nghìn kiểu VN). */
export function formatScale(scale: number): string {
  const rounded = Math.round(scale);
  return `1:${rounded.toLocaleString('vi-VN')}`;
}

/**
 * Các nấc tỷ lệ tròn số cho slider zoom, từ nhỏ (xa) đến lớn (gần).
 * Chỉ giữ các nấc nằm trong [MIN_SCALE, MAX_SCALE].
 */
export const ZOOM_SCALE_LEVELS: number[] = [
  12_800_000, 7_500_000, 5_000_000, 3_000_000, 1_750_000, 1_000_000, 500_000, 250_000, 100_000,
  50_000, 25_000,
];

/**
 * The eight scale stops as zoom levels, ascending — index 0 is the most zoomed
 * out (1:7.500.000), the last index the most zoomed in (1:100.000). Sorted
 * rather than mapped positionally so the slider keeps working left-to-right if
 * someone reorders ZOOM_SCALE_LEVELS.
 */
export const ZOOM_STOPS: readonly number[] = ZOOM_SCALE_LEVELS.map((scale) => zoomForScale(scale)).sort(
  (a, b) => a - b,
);

/** Index of the stop closest to a zoom. Ties go to the lower index. */
export function nearestStopIndex(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STOPS.length; i++) {
    if (Math.abs(ZOOM_STOPS[i] - zoom) < Math.abs(ZOOM_STOPS[best] - zoom)) {
      best = i;
    }
  }
  return best;
}

/** Số chữ số có nghĩa mà số tỷ lệ được làm tròn về khi khung nhìn dừng. */
export const SIGNIFICANT_DIGITS = 3;

/**
 * Làm tròn mẫu số tỷ lệ về SIGNIFICANT_DIGITS chữ số có nghĩa, kẹp trong giới
 * hạn thu phóng để một lần bám không đẩy khung nhìn vượt MIN_SCALE/MAX_SCALE.
 *
 * TRƯỚC ĐÂY là lưới cố định 1.000 đơn vị. Lưới cố định ổn khi dải chỉ tới
 * 1:100.000 (bước 1%), nhưng ở 1:25.000 nó thành bước 4% — đủ thô để thấy số
 * nhảy giật khi thu phóng ở đầu gần. Ba chữ số có nghĩa là lưới TỶ LỆ THUẬN,
 * nên bước nhảy cảm giác như nhau ở mọi chỗ trong dải.
 *
 * Mọi nấc trong ZOOM_SCALE_LEVELS đều đã là số 3 chữ số có nghĩa, nên lần thu
 * phóng do thanh trượt hay nút bấm tạo ra rơi đúng vào giá trị hàm này để yên —
 * hai kiểu bám không đá nhau. Có ca kiểm thử giữ điều đó.
 */
export function snapScaleForReadout(scale: number): number {
  const exponent = Math.floor(Math.log10(scale)) - (SIGNIFICANT_DIGITS - 1);
  const step = Math.pow(10, exponent);
  const snapped = Math.round(scale / step) * step;
  return Math.min(MIN_SCALE, Math.max(MAX_SCALE, snapped));
}

/**
 * How close a scale must already be to its snapped value to count as settled.
 *
 * NOT half the snapping step. Because snapScaleForReadout rounds, every possible
 * input is within half a step of its own snapped value — a guard that wide
 * would return null for everything and the map would never snap at all. What
 * distinguishes a settled view is that its scale IS its snapped value, which is
 * only true after a correction has been applied. One unit of denominator is far
 * below anything visible and far above the float round-trip error through
 * zoomForScale/scaleAtZoom.
 */
const SETTLED_EPSILON = 1;

/**
 * The zoom the view should be corrected to once it settles, or null if it is
 * already on a round scale and must be left alone.
 *
 * Returning null is what terminates the moveend cycle in MapModel — see the
 * loop-guard test in zoomScale.test.ts.
 */
export function settleZoomCorrection(zoom: number): number | null {
  const scale = scaleAtZoom(zoom);
  const snapped = snapScaleForReadout(scale);
  if (Math.abs(scale - snapped) < SETTLED_EPSILON) return null;
  return zoomForScale(snapped);
}

/**
 * Mẫu số tỷ lệ ứng với một resolution của OpenLayers (mét Mercator, EPSG:3857).
 *
 * OL trả resolution chưa hiệu chỉnh vĩ độ, trong khi resolutionAtZoom ở trên trả
 * resolution MẶT ĐẤT (đã nhân cos). Nhân cos ở đây để hai đường tính ra cùng một
 * tỷ lệ — nếu không, ngưỡng LOD và số tỷ lệ trên thanh công cụ sẽ lệch nhau.
 */
export function scaleAtResolution(resolution: number, latitude = REFERENCE_LATITUDE): number {
  return resolution * Math.cos((latitude * Math.PI) / 180) * (SCREEN_DPI / INCH_M);
}
