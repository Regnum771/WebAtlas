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
 * Thu nhỏ hết cỡ: 1:7.500.000 — đủ để trọn VIETNAM_EXTENT_4326 (~1.725 km Bắc–Nam)
 * lọt vào khung nhìn cao ~900 px, còn dư chút lề.
 */
export const MIN_SCALE = 7_500_000;
/** Phóng to hết cỡ: 1:100.000. */
export const MAX_SCALE = 100_000;

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
  7_500_000, 5_000_000, 3_000_000, 1_750_000, 1_000_000, 500_000, 250_000, 100_000,
];
