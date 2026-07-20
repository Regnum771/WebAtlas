import type { EditableLayerKey } from '@webatlas/shared';

// Vietnamese display names for the thematic layers (mirrors data/mockData).
// Lives in the model so both the filter panel (view) and search (model) can use it
// without a view -> model dependency inversion.
export const LAYER_LABELS: Record<EditableLayerKey, string> = {
  dams: 'Đập & Hồ chứa',
  rivers: 'Mạng lưới sông ngòi',
  stations: 'Trạm quan trắc',
  flood_zones: 'Vùng ngập lụt',
  drought_points: 'Vùng hạn hán',
  saltwater_intrusion: 'Xâm nhập mặn',
  flood_generation: 'Vùng sinh lũ',
};
