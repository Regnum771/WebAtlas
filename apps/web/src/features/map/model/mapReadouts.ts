import ScaleLine from 'ol/control/ScaleLine';
import MousePosition from 'ol/control/MousePosition';

/** Số chữ số thập phân cho toạ độ hiển thị. Sáu chữ số ~ 0,1 m: thừa so với độ
 *  chính xác dữ liệu, nhưng ổn định và dễ chép lại — giống bản đồ tham chiếu. */
const COORD_DECIMALS = 6;

/**
 * Toạ độ kiểu bản đồ: KINH ĐỘ TRƯỚC, bán cầu là hậu tố chữ chứ không phải dấu âm.
 * Quy ước này khớp với thuyloivietnam.vn và với cách đọc toạ độ trong ngành.
 */
export function formatLonLat(coord: number[] | undefined): string {
  if (!coord || coord.length < 2) return '';
  const [lon, lat] = coord;
  const ew = lon >= 0 ? 'E' : 'W';
  const ns = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lon).toFixed(COORD_DECIMALS)}°${ew}  ${Math.abs(lat).toFixed(COORD_DECIMALS)}°${ns}`;
}

/** Thước tỷ lệ trong thanh trạng thái: một đoạn thẳng kèm khoảng cách ("200 km"); OL tự đổi
 *  đơn vị xuống m khi phóng gần. Tỷ số "1:…" do ô đọc tỷ lệ của thanh trạng thái hiện, nên ở
 *  đây không vẽ thêm thanh có vạch.
 *
 *  CHỈ HỆ MÉT: dặm không mang thông tin gì cho công tác thuỷ lợi Việt Nam. */
export function createScaleBar(): ScaleLine {
  return new ScaleLine({ units: 'metric', minWidth: 64, className: 'map-scaleline' });
}

/** Toạ độ con trỏ trong thanh trạng thái, quy đổi sang EPSG:4326 dù khung nhìn bản đồ
 *  là EPSG:3857 — `projection` của MousePosition lo việc quy đổi này. */
export function createMousePosition(): MousePosition {
  return new MousePosition({
    projection: 'EPSG:4326',
    coordinateFormat: formatLonLat,
    className: 'map-mouseposition',
    placeholder: '',
  });
}
