import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { wfsUrl } from './wfsSource';
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';

/**
 * Lớp sông tổng quan nhường chỗ ĐÚNG tại ngưỡng của lớp sông đầy đủ.
 *
 * Lấy thẳng từ LAYER_DISPLAY thay vì chép số 8,5: hai lớp mà chồng nhau dù chỉ
 * một chút thì bucket 3 bị vẽ hai lần ở hai mức đơn giản hoá khác nhau, trông
 * như con sông bị nhân đôi. Có ca kiểm thử giữ hai con số này luôn bằng nhau.
 */
export const RIVER_OVERVIEW_MAX_ZOOM = LAYER_DISPLAY.layer_rivers.minZoom as number;

/** Dưới ngưỡng thì lớp tổng quan vẽ; từ ngưỡng trở lên lớp đầy đủ tiếp quản. */
export function riverOverviewVisibleAt(zoom: number): boolean {
  return zoom < RIVER_OVERVIEW_MAX_ZOOM;
}

/**
 * Nguồn dữ liệu cho lớp sông tổng quan.
 *
 * KHÔNG dùng chiến lược bbox như các lớp chuyên đề khác: cả lớp chỉ 146 kB (279
 * đối tượng đã gộp theo tên, hình học đã đơn giản hoá), nên tải trọn một lần rẻ
 * hơn là chia nhỏ theo từng khung nhìn — mà ở mức thu nhỏ thì một khung nhìn đã
 * gần như phủ hết vùng rồi.
 *
 * Không đi qua createWfsVectorSource vì hàm đó nhận EditableLayerKey và tra
 * LAYER_ATTRIBUTE_MAP; lớp này là lớp dẫn xuất chỉ để hiển thị, không có trong
 * hợp đồng thuộc tính và cũng không cần đổi tên trường.
 */
export function createRiverOverviewSource(): VectorSource {
  return new VectorSource({
    format: new GeoJSON(),
    url: wfsUrl('webatlas:rivers_overview'),
  });
}
