import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import type { DictFeatureType } from '../types.js';
import { VALID_FROM, externalIdAttribute, managingUnitAttribute, nameAttribute, storedValues } from './common.js';

export const stations: DictFeatureType = {
  key: 'stations',
  kind: 'vector',
  name: 'Trạm quan trắc',
  definition: 'Trạm quan trắc thủy văn đo mực nước hoặc lượng mưa, mỗi trạm được biểu diễn bằng một điểm.',
  table: 'water.stations',
  crs: 4326,
  geometryType: LAYER_GEOMETRY.stations,
  geometryMeaning: 'representativePoint',
  validFrom: VALID_FROM,
  attributes: [
    nameAttribute('Tên trạm quan trắc.'),
    externalIdAttribute(),
    managingUnitAttribute(),
    {
      name: 'station_type',
      source: 'column',
      valueType: 'code',
      label: 'Loại trạm',
      definition: 'Đại lượng chính mà trạm đo.',
      codeList: 'open',
      values: storedValues(['Đo mực nước', 'Đo lượng mưa']),
      validFrom: VALID_FROM,
    },
    {
      name: 'status',
      source: 'column',
      valueType: 'code',
      label: 'Trạng thái hoạt động',
      definition: 'Tình trạng hoạt động hiện tại của trạm.',
      codeList: 'open',
      values: storedValues(['Hoạt động']),
      validFrom: VALID_FROM,
    },
    {
      name: 'value',
      source: 'column',
      valueType: 'text',
      label: 'Giá trị đo',
      definition:
        'Giá trị đo gần nhất, ghi dạng chữ kèm tên đại lượng và đơn vị, ví dụ mực nước tính bằng mét hoặc lượng mưa tính bằng milimét trong 24 giờ.',
      validFrom: VALID_FROM,
    },
  ],
};
