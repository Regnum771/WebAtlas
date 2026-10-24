import type { DictFeatureType } from '../types.js';
import { VALID_FROM, areaKm2Attribute, nameAttribute, nameEnAttribute } from './common.js';

export const provinces: DictFeatureType = {
  key: 'provinces',
  kind: 'vector',
  name: 'Ranh giới Tỉnh',
  definition: 'Ranh giới các tỉnh, thành phố trực thuộc trung ương sau sắp xếp đơn vị hành chính ngày 01/7/2025.',
  table: 'admin.provinces',
  crs: 4326,
  geometryType: 'MultiPolygon',
  geometryMeaning: 'exact',
  validFrom: VALID_FROM,
  attributes: [
    {
      name: 'code',
      source: 'column',
      valueType: 'text',
      label: 'Mã tỉnh',
      definition: 'Mã đơn vị hành chính cấp tỉnh gồm hai chữ số, ví dụ 01 là Hà Nội.',
      validFrom: VALID_FROM,
    },
    nameAttribute('Tên tỉnh, thành phố không kèm cấp hành chính, ví dụ Hà Nội.'),
    nameEnAttribute('Tên tỉnh, thành phố viết không dấu, ví dụ Hanoi.'),
    {
      name: 'full_name',
      source: 'column',
      valueType: 'text',
      label: 'Tên đầy đủ',
      definition: 'Tên kèm cấp hành chính, ví dụ Thành phố Hà Nội hoặc Tỉnh Cao Bằng.',
      validFrom: VALID_FROM,
    },
    areaKm2Attribute('Diện tích của tỉnh, thành phố theo tệp ranh giới nguồn.'),
  ],
};
