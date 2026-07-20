import type { EditableLayerKey } from './index';

export type FilterFieldType = 'enum' | 'number' | 'date' | 'text';

export interface FilterField {
  /** ISO/INSPIRE property name as stored on the in-memory feature. */
  iso: string;
  /** Vietnamese UI label. */
  label: string;
  type: FilterFieldType;
  /** For 'enum' — the allowed (canonical) values. */
  enumValues?: string[];
}

// Canonical dam status slugs (match wfsSource.ts stamping via toDamStatusSlug).
const DAM_STATUS_SLUGS = ['binh_thuong', 'xa_lu', 'nguy_hiem'] as const;
// Hazard riskLevel values — the seed data stores Vietnamese labels, NOT low/medium/high
// (verified against apps/api/src/db/seeds/data/*.geojson). Filter must match the real strings.
const RISK_LEVELS = ['Cao', 'Trung bình', 'Thấp'] as const;

// Filterable fields per layer, keyed by the ISO name on the feature.
// localId/geographicalNameEn and pure ids are omitted — not useful filters.
//
// IMPORTANT — type reflects the REAL data shape (verified against seed sources):
//   * dams wattage_mw (Wattage_PL) and rivers stream_order/length_m (Cap/Chieu_dai) are
//     genuine numbers -> 'number'.
//   * hazard `area`/`salinity` and station `value` are labeled STRINGS in the data
//     ("120 km2", "4.2 g/l", "Mực nước: 2.3m") -> 'text', NOT 'number'. A numeric >= on
//     "120 km2" would fail. They are still useful as text-contains filters.
//   * riskLevel is a Vietnamese enum ("Cao"/"Trung bình").
export const LAYER_FILTER_FIELDS: Record<EditableLayerKey, FilterField[]> = {
  dams: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'statusSlug', label: 'Trạng thái', type: 'enum', enumValues: [...DAM_STATUS_SLUGS] },
    { iso: 'ratedPower', label: 'Công suất (MW)', type: 'number' },       // Wattage_PL: real number
    { iso: 'commissioningYear', label: 'Năm vận hành', type: 'number' },  // year: real number where present
  ],
  rivers: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'streamOrder', label: 'Cấp sông', type: 'number' },  // Cap: real number
    { iso: 'length', label: 'Chiều dài (m)', type: 'number' },  // Chieu_dai: real number
  ],
  stations: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'measurementType', label: 'Loại trạm', type: 'text' },
    { iso: 'operationalStatus', label: 'Trạng thái', type: 'text' },
    { iso: 'measurementValue', label: 'Giá trị đo', type: 'text' },  // "Mực nước: 2.3m" — labeled string
  ],
  flood_zones: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'hazardType', label: 'Loại hiểm họa', type: 'text' },
    { iso: 'affectedArea', label: 'Diện tích ảnh hưởng', type: 'text' },  // "15.4 km2" — labeled string
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
  ],
  drought_points: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
    { iso: 'observedStatus', label: 'Trạng thái', type: 'text' },
    { iso: 'observationDate', label: 'Ngày khảo sát', type: 'date' },
  ],
  saltwater_intrusion: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'salinity', label: 'Độ mặn', type: 'text' },  // "4.2 g/l" — labeled string
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
    { iso: 'observedStatus', label: 'Trạng thái', type: 'text' },
  ],
  flood_generation: [
    { iso: 'geographicalName', label: 'Tên', type: 'text' },
    { iso: 'riskLevel', label: 'Mức rủi ro', type: 'enum', enumValues: [...RISK_LEVELS] },
    { iso: 'catchmentArea', label: 'Diện tích lưu vực', type: 'text' },  // "120 km2" — labeled string
  ],
};
