import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import { VALID_FROM, externalIdAttribute, managingUnitAttribute, nameAttribute, riskLevelAttribute, } from './common.js';
export const drought_points = {
    key: 'drought_points',
    kind: 'vector',
    name: 'Điểm hạn hán',
    definition: 'Điểm khảo sát tình trạng hạn hán và thiếu nước, mỗi điểm đại diện cho khu vực được khảo sát.',
    table: 'water.drought_points',
    crs: 4326,
    geometryType: LAYER_GEOMETRY.drought_points,
    geometryMeaning: 'representativePoint',
    validFrom: VALID_FROM,
    attributes: [
        nameAttribute('Tên điểm khảo sát hạn hán.'),
        externalIdAttribute(),
        managingUnitAttribute(),
        riskLevelAttribute('Mức rủi ro hạn hán tại điểm khảo sát.'),
        {
            // A free description of what was observed, not a list of codes.
            name: 'status',
            source: 'column',
            valueType: 'text',
            label: 'Trạng thái',
            definition: 'Mô tả tình trạng nguồn nước quan sát được tại điểm khảo sát.',
            validFrom: VALID_FROM,
        },
        {
            name: 'survey_date',
            source: 'column',
            valueType: 'date',
            label: 'Ngày khảo sát',
            definition: 'Ngày tiến hành khảo sát tại điểm.',
            validFrom: VALID_FROM,
        },
    ],
};
