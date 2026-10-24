import type { DictFeatureType } from '../types.js';
import {
  VALID_FROM,
  floodMaxDepthAttribute,
  nameAttribute,
  osmIdAttribute,
  scenarioHourAttribute,
  scenarioIdAttribute,
} from './common.js';

export const flood_roads: DictFeatureType = {
  key: 'flood_roads',
  kind: 'vector',
  name: 'Đường bị ngập theo kịch bản',
  definition:
    'Đoạn đường OpenStreetMap bị ngập sâu từ 0,3 m trở lên trong mỗi kịch bản lũ, kèm giờ bắt đầu ngập.',
  table: 'scenario.flood_road',
  crs: 4326,
  geometryType: 'LineString',
  geometryMeaning: 'exact',
  validFrom: VALID_FROM,
  attributes: [
    osmIdAttribute(),
    nameAttribute('Tên đường theo OpenStreetMap, nếu có.'),
    {
      name: 'ref',
      source: 'column',
      valueType: 'text',
      label: 'Số hiệu',
      definition: 'Số hiệu tuyến đường theo OpenStreetMap, ví dụ QL.1 hoặc ĐT.608.',
      validFrom: VALID_FROM,
    },
    {
      // Closed: floodLayers.ts (roadStyleKey) styles a road as major or minor by branching on
      // these codes, and the build keeps exactly these classes (ROAD_CLASSES in exposure.py).
      // Names follow the basemap popup's FCLASS_LABELS (DynamicPopup.tsx).
      name: 'fclass',
      source: 'column',
      valueType: 'code',
      label: 'Loại',
      definition: 'Cấp đường theo phân loại OpenStreetMap của Geofabrik.',
      codeList: 'closed',
      values: [
        { code: 'trunk', name: 'Quốc lộ', order: 1 },
        { code: 'primary', name: 'Đường chính', order: 2 },
        { code: 'secondary', name: 'Đường liên tỉnh', order: 3 },
        { code: 'tertiary', name: 'Đường liên huyện', order: 4 },
        { code: 'unclassified', name: 'Đường chưa phân loại', order: 5 },
        { code: 'residential', name: 'Đường khu dân cư', order: 6 },
        { code: 'trunk_link', name: 'Nhánh quốc lộ', order: 7 },
        { code: 'primary_link', name: 'Nhánh đường chính', order: 8 },
        { code: 'secondary_link', name: 'Nhánh liên tỉnh', order: 9 },
        { code: 'tertiary_link', name: 'Nhánh liên huyện', order: 10 },
      ],
      validFrom: VALID_FROM,
    },
    {
      name: 'length_m',
      source: 'column',
      valueType: 'number',
      label: 'Chiều dài',
      definition: 'Chiều dài của đoạn đường.',
      storedUnit: 'm',
      displayUnits: ['km', 'm'],
      displayUnit: 'km',
      precision: 2,
      validFrom: VALID_FROM,
    },
    scenarioHourAttribute(
      'cut_hour',
      'Giờ ngập đường',
      'Số giờ kể từ đầu kịch bản đến khi một điểm trên đoạn đường ngập sâu từ 0,3 m trở lên.',
    ),
    floodMaxDepthAttribute('Độ sâu ngập lớn nhất trên đoạn đường trong suốt kịch bản.'),
    scenarioIdAttribute(),
  ],
};
