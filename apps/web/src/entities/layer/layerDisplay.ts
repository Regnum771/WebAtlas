import { ADMIN_BOUNDARY_LAYER_STATE_IDS, BASEMAP_CONTEXT_LAYER_STATE_IDS, TERRAIN_LAYER_STATE_IDS } from '@webatlas/shared';

export interface LayerDisplayMeta {
  name: string;
  group: string;
  /** Zoom below which the layer is not loaded — surfaced in the panel as a hint. */
  minZoom?: number;
  /** Seeds MapProvider's initial layersState (Task 10 removes the mockData source). */
  defaultVisible: boolean;
  opacity: number;
}

// Read from the shared constant rather than typed as literals here a second
// time — that duplication is exactly what let LAYER_STATE_IDS (shared) and
// LAYER_DISPLAY (here) drift in the past (see the terrain/dem and legend
// colour incidents referenced in map-commands.ts).
const [PROVINCES_LAYER_STATE_ID, WARDS_LAYER_STATE_ID] = ADMIN_BOUNDARY_LAYER_STATE_IDS;
const [BM_ROADS, BM_RAILWAYS, BM_WATER, BM_LANDUSE] = BASEMAP_CONTEXT_LAYER_STATE_IDS;
const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;

/** Presentation metadata keyed by layerStateId. The API catalog is the authority
 *  on which layers exist and are editable; this supplies names and grouping,
 *  including for the client-only administrative boundaries. */
export const LAYER_DISPLAY: Record<string, LayerDisplayMeta> = {
  // Lớp ngữ cảnh của nền bản đồ: raster từ GeoServer, dữ liệu OSM (ODbL).
  // Tách rời từng lớp để bật/tắt độc lập — mỗi lớp là một layer group riêng nên
  // có cache GWC riêng, và tắt đi KHÔNG giải phóng source (tile đã tải vẫn nằm
  // trong cache của OpenLayers, bật lại hiện ngay).
  // Khoá đọc từ hằng dùng chung, KHÔNG gõ tay lần thứ hai.
  [BM_ROADS]: { name: 'Giao thông đường bộ', group: 'Nền bản đồ', defaultVisible: true, opacity: 1 },
  [BM_RAILWAYS]: { name: 'Đường sắt', group: 'Nền bản đồ', defaultVisible: true, opacity: 1 },
  [BM_WATER]: { name: 'Mặt nước nền', group: 'Nền bản đồ', defaultVisible: true, opacity: 1 },
  [BM_LANDUSE]: { name: 'Sử dụng đất', group: 'Nền bản đồ', defaultVisible: false, opacity: 1 },

  // Đường đồng mức dựng từ DEM (FABDEM, bare earth). Vẽ chồng lên CẢ BA nền — nền là một
  // lớp duy nhất đổi source, còn lớp này nằm trên nó như các lớp ngữ cảnh khác.
  // Mặc định TẮT: hữu ích khi cần, nhưng bật sẵn thì làm rối nền đường phố.
  [CONTOURS]: { name: 'Đường đồng mức', group: 'Địa hình', defaultVisible: false, opacity: 0.8 },

  [PROVINCES_LAYER_STATE_ID]: { name: 'Ranh giới Tỉnh', group: 'Ranh giới hành chính', defaultVisible: true, opacity: 1 },
  [WARDS_LAYER_STATE_ID]: { name: 'Ranh giới Xã/Phường', group: 'Ranh giới hành chính', minZoom: 10, defaultVisible: true, opacity: 1 },
  layer_dams: { name: 'Đập & Hồ chứa', group: 'Tài nguyên nước', defaultVisible: true, opacity: 1 },
  layer_rivers: { name: 'Mạng lưới sông ngòi', group: 'Tài nguyên nước', minZoom: 8.5, defaultVisible: true, opacity: 0.8 },
  layer_lakes: { name: 'Hồ & Hồ chứa', group: 'Tài nguyên nước', minZoom: 8.5, defaultVisible: true, opacity: 0.85 },
  layer_stations: { name: 'Trạm quan trắc', group: 'Tài nguyên nước', defaultVisible: false, opacity: 1 },
  layer_flood: { name: 'Vùng ngập lụt', group: 'Hiểm họa', defaultVisible: false, opacity: 0.6 },
  layer_drought_survey: { name: 'Vùng hạn hán', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
  layer_saltwater_intrusion: { name: 'Xâm nhập mặn', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
  layer_flood_generation: { name: 'Vùng sinh lũ', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
};
