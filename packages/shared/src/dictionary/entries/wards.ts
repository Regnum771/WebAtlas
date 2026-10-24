import type { DictFeatureType } from '../types.js';
import { VALID_FROM, areaKm2Attribute, nameAttribute, nameEnAttribute } from './common.js';

export const wards: DictFeatureType = {
  key: 'wards',
  kind: 'vector',
  name: 'Ranh giới Xã/Phường',
  definition: 'Ranh giới xã, phường và đặc khu sau sắp xếp đơn vị hành chính ngày 01/7/2025, trong các tỉnh của vùng làm việc.',
  table: 'admin.wards',
  crs: 4326,
  geometryType: 'MultiPolygon',
  geometryMeaning: 'exact',
  validFrom: VALID_FROM,
  attributes: [
    {
      name: 'code',
      source: 'column',
      valueType: 'text',
      label: 'Mã xã/phường',
      definition: 'Mã đơn vị hành chính cấp xã gồm năm chữ số.',
      validFrom: VALID_FROM,
    },
    {
      name: 'province_code',
      source: 'column',
      valueType: 'text',
      label: 'Mã tỉnh',
      definition: 'Mã của tỉnh, thành phố chứa xã/phường.',
      validFrom: VALID_FROM,
    },
    nameAttribute('Tên xã, phường không kèm cấp hành chính, ví dụ Hải Vân.'),
    nameEnAttribute('Tên xã, phường viết không dấu, ví dụ Hai Van.'),
    {
      name: 'full_name',
      source: 'column',
      valueType: 'text',
      label: 'Tên đầy đủ',
      definition: 'Tên kèm cấp hành chính, ví dụ Phường Hải Vân hoặc Xã Hoà Vang.',
      validFrom: VALID_FROM,
    },
    areaKm2Attribute('Diện tích của xã, phường theo tệp ranh giới nguồn.'),
  ],
};
