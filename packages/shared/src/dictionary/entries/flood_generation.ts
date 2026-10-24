import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import type { DictFeatureType } from '../types.js';
import {
  VALID_FROM,
  externalIdAttribute,
  managingUnitAttribute,
  nameAttribute,
  riskLevelAttribute,
} from './common.js';

export const flood_generation: DictFeatureType = {
  key: 'flood_generation',
  kind: 'vector',
  name: 'Vùng sinh lũ',
  definition: 'Lưu vực nơi dòng lũ hình thành, với ranh giới chỉ mang tính gần đúng.',
  table: 'water.flood_generation',
  crs: 4326,
  geometryType: LAYER_GEOMETRY.flood_generation,
  geometryMeaning: 'approximate',
  validFrom: VALID_FROM,
  attributes: [
    nameAttribute('Tên vùng sinh lũ.'),
    externalIdAttribute(),
    managingUnitAttribute(),
    riskLevelAttribute('Mức rủi ro lũ của vùng.'),
    {
      name: 'area',
      source: 'column',
      valueType: 'text',
      label: 'Diện tích lưu vực',
      definition: 'Diện tích lưu vực sinh lũ, ghi dạng chữ kèm đơn vị ki-lô-mét vuông, ví dụ 85 km2.',
      validFrom: VALID_FROM,
    },
    {
      // Ruling 2 lists this as a number with a unit, but every stored value today is a description.
      name: 'flow_rate',
      source: 'column',
      valueType: 'text',
      label: 'Đặc điểm lũ',
      definition: 'Mô tả đặc điểm dòng lũ của vùng, như cường độ và tốc độ hình thành, ghi dạng chữ.',
      validFrom: VALID_FROM,
    },
  ],
};
