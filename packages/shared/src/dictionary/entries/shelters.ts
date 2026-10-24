import type { DictFeatureType } from '../types.js';
import { VALID_FROM, nameAttribute } from './common.js';

export const shelters: DictFeatureType = {
  key: 'shelters',
  kind: 'vector',
  name: 'Điểm tập kết',
  definition:
    'Trường học, nhà văn hoá và công trình công cộng khác còn khô trong kịch bản lũ lớn nhất, dùng làm điểm tập kết khi sơ tán.',
  table: 'scenario.shelter',
  crs: 4326,
  geometryType: 'Point',
  geometryMeaning: 'representativePoint',
  validFrom: VALID_FROM,
  attributes: [
    nameAttribute('Tên công trình theo OpenStreetMap, nếu có.'),
    {
      // Open: only the assistant's SHELTER_KINDS reads these codes, as a label lookup that falls
      // back to "điểm tập kết"; no behaviour depends on them. Names follow that lookup.
      name: 'kind',
      source: 'column',
      valueType: 'code',
      label: 'Loại',
      definition: 'Loại công trình theo phân loại OpenStreetMap của Geofabrik.',
      codeList: 'open',
      values: [
        { code: 'school', name: 'Trường học', order: 1 },
        { code: 'kindergarten', name: 'Trường mầm non', order: 2 },
        { code: 'college', name: 'Trường cao đẳng', order: 3 },
        { code: 'university', name: 'Trường đại học', order: 4 },
        { code: 'community_centre', name: 'Nhà văn hoá', order: 5 },
        { code: 'place_of_worship', name: 'Cơ sở tôn giáo', order: 6 },
      ],
      validFrom: VALID_FROM,
    },
  ],
};
