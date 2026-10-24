import type { DictAttribute, DictFeatureType } from '../types.js';
import { VALID_FROM, nameAttribute } from './common.js';

function alarmLevel(name: string, grade: string): DictAttribute {
  return {
    name,
    source: 'column',
    valueType: 'number',
    label: `Mức báo động ${grade}`,
    definition: `Mực nước tại trạm ứng với cấp báo động lũ ${grade}.`,
    storedUnit: 'm',
    displayUnits: ['m', 'cm'],
    displayUnit: 'm',
    precision: 2,
    validFrom: VALID_FROM,
  };
}

export const flood_stations: DictFeatureType = {
  key: 'flood_stations',
  kind: 'vector',
  name: 'Trạm mực nước kịch bản lũ',
  definition: 'Trạm đo mực nước trên sông Vu Gia – Thu Bồn mà kịch bản lũ dùng để dựng mặt nước ngập.',
  table: 'scenario.flood_station',
  crs: 4326,
  geometryType: 'Point',
  geometryMeaning: 'representativePoint',
  validFrom: VALID_FROM,
  attributes: [
    nameAttribute('Tên trạm đo mực nước.'),
    {
      name: 'river',
      source: 'column',
      valueType: 'text',
      label: 'Sông',
      definition: 'Tên sông nơi đặt trạm.',
      validFrom: VALID_FROM,
    },
    alarmLevel('bd1', 'I'),
    alarmLevel('bd2', 'II'),
    alarmLevel('bd3', 'III'),
    {
      name: 'record_m',
      source: 'column',
      valueType: 'number',
      label: 'Mực nước lũ lịch sử',
      definition: 'Mực nước cao nhất từng ghi nhận tại trạm, nếu biết.',
      storedUnit: 'm',
      displayUnits: ['m', 'cm'],
      displayUnit: 'm',
      precision: 2,
      validFrom: VALID_FROM,
    },
    {
      // Stored as float8, but a calendar year: text, so 2009 never shows as 2.009.
      name: 'record_year',
      source: 'column',
      valueType: 'text',
      label: 'Năm lũ lịch sử',
      definition: 'Năm xảy ra mực nước lũ lịch sử của trạm, nếu biết.',
      validFrom: VALID_FROM,
    },
    {
      // Closed: a boolean column admits only these two, and the flood dock and the assistant
      // mark derived stations with "(ước tính)" by branching on it.
      name: 'derived',
      source: 'column',
      valueType: 'code',
      label: 'Nguồn mực nước',
      definition:
        'Cho biết chuỗi mực nước của trạm được ước tính từ trạm khác hay lấy từ số liệu thực đo trong bản tin lũ.',
      codeList: 'closed',
      values: [
        { code: 'false', name: 'Thực đo', order: 1 },
        { code: 'true', name: 'Ước tính từ trạm khác', order: 2 },
      ],
      validFrom: VALID_FROM,
    },
  ],
};
