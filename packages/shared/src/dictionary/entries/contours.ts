import type { DictFeatureType } from '../types.js';
import { VALID_FROM } from './common.js';

export const contours: DictFeatureType = {
  key: 'contours',
  kind: 'vector',
  name: 'Đường đồng mức',
  definition: 'Đường nối các điểm cùng độ cao, dựng từ mô hình số độ cao FABDEM theo ba khoảng cao đều 50, 100 và 250 m.',
  table: 'basemap.contours',
  crs: 4326,
  geometryType: 'MultiLineString',
  geometryMeaning: 'exact',
  validFrom: VALID_FROM,
  attributes: [
    {
      name: 'interval_m',
      source: 'column',
      valueType: 'number',
      label: 'Khoảng cao đều',
      definition: 'Chênh lệch độ cao giữa hai đường liền kề trong bộ đường đồng mức chứa đường này.',
      storedUnit: 'm',
      displayUnits: ['m'],
      displayUnit: 'm',
      precision: 0,
      validFrom: VALID_FROM,
    },
    {
      name: 'elevation_m',
      source: 'column',
      valueType: 'number',
      label: 'Độ cao',
      definition: 'Độ cao của đường đồng mức so với mặt geoid EGM2008.',
      storedUnit: 'm',
      displayUnits: ['m'],
      displayUnit: 'm',
      precision: 0,
      validFrom: VALID_FROM,
    },
    {
      // Closed: the contour SLDs (packages/atlas-data/tools/contours/styles.py) filter on
      // is_index true/false, and the column is boolean, so the database admits only these two.
      name: 'is_index',
      source: 'column',
      valueType: 'code',
      label: 'Loại đường',
      definition: 'Cho biết đây là đường cái (cứ năm đường thì một, vẽ đậm và ghi nhãn độ cao) hay đường con.',
      codeList: 'closed',
      values: [
        { code: 'true', name: 'Đường cái', order: 1 },
        { code: 'false', name: 'Đường con', order: 2 },
      ],
      validFrom: VALID_FROM,
    },
  ],
};
