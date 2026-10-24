import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import { DAM_STATUS_DISPLAY, DAM_STATUS_SLUGS } from '../../dam-status.js';
import type { DictFeatureType } from '../types.js';
import { VALID_FROM, externalIdAttribute, managingUnitAttribute, nameAttribute } from './common.js';

const STATUS_DEFINITIONS: Record<(typeof DAM_STATUS_SLUGS)[number], string> = {
  binh_thuong: 'Hồ chứa vận hành bình thường.',
  xa_lu: 'Hồ chứa đang xả lũ qua tràn.',
  nguy_hiem: 'Công trình đang ở tình trạng nguy hiểm, cần theo dõi đặc biệt.',
};

export const dams: DictFeatureType = {
  key: 'dams',
  kind: 'vector',
  name: 'Đập & Hồ chứa',
  definition: 'Đập và hồ chứa thủy điện, mỗi công trình được biểu diễn bằng một điểm.',
  table: 'water.dams',
  crs: 4326,
  geometryType: LAYER_GEOMETRY.dams,
  geometryMeaning: 'representativePoint',
  validFrom: VALID_FROM,
  attributes: [
    nameAttribute('Tên công trình đập, hồ chứa thủy điện bằng tiếng Việt.'),
    externalIdAttribute(),
    managingUnitAttribute(),
    {
      name: 'name_en',
      source: 'column',
      valueType: 'text',
      label: 'Tên tiếng Anh',
      definition: 'Tên công trình viết không dấu theo nguồn dữ liệu quốc tế.',
      validFrom: VALID_FROM,
    },
    {
      name: 'wattage_mw',
      source: 'column',
      valueType: 'number',
      label: 'Công suất',
      definition: 'Công suất lắp máy của nhà máy thủy điện.',
      storedUnit: 'MW',
      displayUnits: ['MW', 'kW'],
      displayUnit: 'MW',
      precision: 1,
      validFrom: VALID_FROM,
    },
    {
      name: 'annual_output',
      source: 'column',
      valueType: 'number',
      label: 'Sản lượng điện',
      definition: 'Sản lượng điện trung bình nhà máy phát ra trong một năm.',
      storedUnit: 'GW.h/a',
      displayUnits: ['GW.h/a'],
      displayUnit: 'GW.h/a',
      precision: 1,
      validFrom: VALID_FROM,
    },
    {
      name: 'year_launched',
      source: 'column',
      valueType: 'text',
      label: 'Khởi công',
      definition: 'Thời điểm khởi công xây dựng, ghi dạng chữ theo năm hoặc tháng/năm, ví dụ 2013 hoặc 7/2005.',
      validFrom: VALID_FROM,
    },
    {
      name: 'year_operational',
      source: 'column',
      valueType: 'text',
      label: 'Năm vận hành',
      definition: 'Thời điểm đưa vào vận hành, ghi dạng chữ theo năm hoặc tháng/năm, ví dụ 2021 hoặc 8/2009.',
      validFrom: VALID_FROM,
    },
    {
      // Closed: dam-status.ts, the dam styling and the popup branch on these slugs (Ruling 8).
      name: 'status',
      source: 'column',
      valueType: 'code',
      label: 'Trạng thái',
      definition: 'Trạng thái vận hành hiện tại của hồ chứa.',
      codeList: 'closed',
      values: DAM_STATUS_SLUGS.map((slug, i) => ({
        code: slug,
        name: DAM_STATUS_DISPLAY[slug].label,
        definition: STATUS_DEFINITIONS[slug],
        order: i + 1,
        colorHint: DAM_STATUS_DISPLAY[slug].color,
      })),
      validFrom: VALID_FROM,
    },
  ],
};
