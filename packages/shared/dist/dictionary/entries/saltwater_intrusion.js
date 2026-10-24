import { LAYER_GEOMETRY } from '../../layer-geometry.js';
import { VALID_FROM, externalIdAttribute, managingUnitAttribute, nameAttribute, riskLevelAttribute, } from './common.js';
export const saltwater_intrusion = {
    key: 'saltwater_intrusion',
    kind: 'vector',
    name: 'Xâm nhập mặn',
    definition: 'Điểm đo độ mặn nơi nước biển xâm nhập vào sông và nội đồng, với vị trí chỉ mang tính gần đúng.',
    table: 'water.saltwater_intrusion',
    crs: 4326,
    geometryType: LAYER_GEOMETRY.saltwater_intrusion,
    geometryMeaning: 'approximate',
    validFrom: VALID_FROM,
    attributes: [
        nameAttribute('Tên điểm đo mặn.'),
        externalIdAttribute(),
        managingUnitAttribute(),
        {
            name: 'salinity',
            source: 'column',
            valueType: 'text',
            label: 'Độ mặn đo được',
            definition: 'Độ mặn đo được, ghi dạng chữ kèm đơn vị gam trên lít, ví dụ 4.2 g/l.',
            validFrom: VALID_FROM,
        },
        riskLevelAttribute('Mức rủi ro xâm nhập mặn tại điểm đo.'),
        {
            // A free description of what was observed, not a list of codes.
            name: 'status',
            source: 'column',
            valueType: 'text',
            label: 'Trạng thái',
            definition: 'Mô tả diễn biến xâm nhập mặn quan sát được tại điểm đo.',
            validFrom: VALID_FROM,
        },
    ],
};
