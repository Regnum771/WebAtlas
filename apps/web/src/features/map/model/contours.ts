/**
 * Đường đồng mức: chọn khoảng cao đều theo mức thu phóng, và tên lớp/kiểu đã xuất bản.
 *
 * Giữ riêng khỏi MapModel để kiểm thử được mà không cần dựng bản đồ — cùng lý do
 * riverOverview.ts tồn tại.
 */

import type { ContourInterval } from '@webatlas/shared';

/**
 * Cài đặt của lớp đường đồng mức.
 *
 * CỐ Ý không nhét vào LayerState ({id, visible, opacity}): hình dạng đó là một phần hợp
 * đồng MapCommand, và một lớp đặc biệt thì không đáng để nới rộng nó. Kiểu này ở đây chứ
 * không ở trong component bảng điều khiển, để provider không phải import ngược từ UI.
 */
export interface ContourSettings {
  /** 'auto' theo mức thu phóng, hoặc một khoảng cố định người dùng chọn. */
  interval: 'auto' | ContourInterval;
  labels: boolean;
}

/**
 * Mức thu phóng -> khoảng cao đều, cho chế độ "Tự động".
 *
 * Ngưỡng theo tỷ lệ chứ không theo cảm tính: dưới zoom 9 (~1:1.100.000) đường 100 m đã dày
 * thành mảng nâu; từ zoom 11 (~1:270.000) đường 50 m mới đủ thưa để đọc.
 */
export function contourIntervalFor(zoom: number): ContourInterval {
  if (zoom < 9) return 250;
  if (zoom < 11) return 100;
  return 50;
}

export function contourGwcLayer(intervalM: ContourInterval | number): string {
  return `webatlas:contours_${intervalM}`;
}

/**
 * Tên kiểu PHẢI kèm workspace. GWC WMTS từ chối tên trần: `STYLE=contours_plain` trả về
 * 400 InvalidParameterValue, chỉ `STYLE=webatlas:contours_plain` mới vẽ được — đo trên
 * GeoServer thật. Sai ở đây thì bản đồ nhận ảnh báo lỗi chứ không có lỗi nào hiện ra.
 */
export function contourStyle(labels: boolean): string {
  return labels ? 'webatlas:contours_labelled' : 'webatlas:contours_plain';
}

/**
 * Vùng phủ dữ liệu đã xuất bản (kinh/vĩ độ, EPSG:4326), KHÔNG PHẢI ranh giới quốc gia.
 *
 * Mọi lớp nền GWC khác đều xuất bản với biên toàn quốc giống hệt nhau (xem ghi chú
 * trong gwcSource() ở MapModel.ts) nên OpenLayers không bao giờ xin tile ngoài biên.
 * Ba lớp đường đồng mức lại xuất bản với biên DỮ LIỆU (107,2026–109,4573 Đ,
 * 10,6899–16,2171 B) — hẹp hơn hẳn. Nếu không đặt extent trên layer, mỗi lần rê bản
 * đồ ra ngoài vùng này OpenLayers vẫn xin tile và GWC trả 400 TileOutOfRange — một
 * lỗi đỏ trên console cho mỗi ô. Số liệu đã nới nhẹ ra ngoài biên đo được để không
 * cắt mất viền dữ liệu do sai số làm tròn.
 */
export const CONTOUR_EXTENT_4326: [number, number, number, number] = [107.2, 10.68, 109.46, 16.22];

/**
 * Ghi công bắt buộc theo giấy phép FABDEM (CC BY-NC-SA, dẫn xuất từ Copernicus
 * WorldDEM-30). Đường đồng mức không được dùng ghi công OSM của gwcSource() —
 * lớp này không hề chứa dữ liệu OSM, và bỏ sót ghi công FABDEM là vi phạm giấy phép.
 */
export const CONTOUR_ATTRIBUTION =
  'FABDEM is produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018.';
