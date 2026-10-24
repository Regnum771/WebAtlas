import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import type { DictFeatureType } from '../types.js';
import {
  VALID_FROM,
  externalIdAttribute,
  managingUnitAttribute,
  nameAttribute,
  riskLevelAttribute,
  storedValues,
} from './common.js';

export const flood_zones: DictFeatureType = {
  key: 'flood_zones',
  kind: 'vector',
  name: 'Vùng ngập lụt',
  definition: 'Vùng có nguy cơ ngập lụt, với ranh giới chỉ mang tính gần đúng.',
  table: 'water.flood_zones',
  crs: 4326,
  geometryType: LAYER_GEOMETRY.flood_zones,
  geometryMeaning: 'approximate',
  validFrom: VALID_FROM,
  attributes: [
    nameAttribute('Tên vùng ngập lụt.'),
    externalIdAttribute(),
    managingUnitAttribute(),
    {
      name: 'hazard_type',
      source: 'column',
      valueType: 'code',
      label: 'Phân loại',
      definition: 'Loại hiểm họa của vùng.',
      codeList: 'open',
      values: storedValues(['Nguy cơ ngập']),
      validFrom: VALID_FROM,
    },
    {
      name: 'area',
      source: 'column',
      valueType: 'text',
      label: 'Diện tích ảnh hưởng',
      definition: 'Diện tích vùng bị ảnh hưởng, ghi dạng chữ kèm đơn vị ki-lô-mét vuông, ví dụ 22.8 km2.',
      validFrom: VALID_FROM,
    },
    riskLevelAttribute('Mức rủi ro ngập lụt của vùng.'),
  ],
};
