export interface LayerDisplayMeta {
  name: string;
  group: string;
  /** Zoom below which the layer is not loaded — surfaced in the panel as a hint. */
  minZoom?: number;
  /** Seeds MapProvider's initial layersState (Task 10 removes the mockData source). */
  defaultVisible: boolean;
  opacity: number;
}

/** Presentation metadata keyed by layerStateId. The API catalog is the authority
 *  on which layers exist and are editable; this supplies names and grouping,
 *  including for the client-only administrative boundaries. */
export const LAYER_DISPLAY: Record<string, LayerDisplayMeta> = {
  layer_provinces_2026: { name: 'Ranh giới Tỉnh', group: 'Ranh giới hành chính', defaultVisible: true, opacity: 1 },
  layer_wards_2026: { name: 'Ranh giới Xã/Phường', group: 'Ranh giới hành chính', minZoom: 10, defaultVisible: true, opacity: 1 },
  layer_dams: { name: 'Đập & Hồ chứa', group: 'Tài nguyên nước', defaultVisible: true, opacity: 1 },
  layer_rivers: { name: 'Mạng lưới sông ngòi', group: 'Tài nguyên nước', minZoom: 8.5, defaultVisible: true, opacity: 0.8 },
  layer_lakes: { name: 'Hồ & Hồ chứa', group: 'Tài nguyên nước', minZoom: 8.5, defaultVisible: true, opacity: 0.85 },
  layer_stations: { name: 'Trạm quan trắc', group: 'Tài nguyên nước', defaultVisible: false, opacity: 1 },
  layer_flood: { name: 'Vùng ngập lụt', group: 'Hiểm họa', defaultVisible: false, opacity: 0.6 },
  layer_drought_survey: { name: 'Vùng hạn hán', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
  layer_saltwater_intrusion: { name: 'Xâm nhập mặn', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
  layer_flood_generation: { name: 'Vùng sinh lũ', group: 'Hiểm họa', defaultVisible: false, opacity: 0.7 },
};
