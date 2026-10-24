import { VALID_FROM, floodMaxDepthAttribute, scenarioHourAttribute, scenarioIdAttribute } from './common.js';
function count(name, label, definition) {
    return {
        name,
        source: 'column',
        valueType: 'number',
        label,
        definition,
        storedUnit: '1',
        displayUnits: ['1'],
        displayUnit: '1',
        precision: 0,
        validFrom: VALID_FROM,
    };
}
export const flood_wards = {
    key: 'flood_wards',
    kind: 'vector',
    name: 'Xã/phường bị ngập theo kịch bản',
    definition: 'Mức độ ảnh hưởng của mỗi kịch bản lũ tới từng xã/phường có nhà bị ngập, đặt tại tâm các nhà bị ngập.',
    table: 'scenario.flood_ward',
    crs: 4326,
    geometryType: 'Point',
    geometryMeaning: 'representativePoint',
    validFrom: VALID_FROM,
    attributes: [
        {
            name: 'ward_code',
            source: 'column',
            valueType: 'text',
            label: 'Mã xã/phường',
            definition: 'Mã đơn vị hành chính cấp xã của xã/phường.',
            validFrom: VALID_FROM,
        },
        {
            name: 'ward_name',
            source: 'column',
            valueType: 'text',
            label: 'Tên xã/phường',
            definition: 'Tên xã/phường kèm cấp hành chính, ví dụ Phường Hoà Xuân.',
            validFrom: VALID_FROM,
        },
        {
            name: 'short_name',
            source: 'column',
            valueType: 'text',
            label: 'Tên ngắn',
            definition: 'Tên xã/phường không kèm cấp hành chính, ví dụ Hoà Xuân.',
            validFrom: VALID_FROM,
        },
        count('buildings_total', 'Tổng số nhà', 'Số nhà của xã/phường có trong dữ liệu nhà OpenStreetMap thuộc vùng mô phỏng.'),
        count('buildings_flooded', 'Số nhà ngập', 'Số nhà bị ngập sâu từ 0,2 m trở lên vào một lúc nào đó trong kịch bản.'),
        count('people_est', 'Số người ước tính', 'Số người sống trong các nhà bị ngập, ước tính 4 người mỗi nhà.'),
        scenarioHourAttribute('first_hour', 'Giờ bắt đầu ngập', 'Số giờ kể từ đầu kịch bản đến khi 5% số nhà của xã/phường bị ngập, hoặc đến khi nhà đầu tiên ngập nếu số nhà ngập ít hơn thế.'),
        scenarioHourAttribute('deadline_hour', 'Hạn sơ tán', 'Số giờ kể từ đầu kịch bản đến hạn sơ tán, sớm hơn giờ bắt đầu ngập 3 giờ và không trước giờ 0.'),
        floodMaxDepthAttribute('Độ sâu ngập lớn nhất tại các nhà bị ngập của xã/phường trong suốt kịch bản.'),
        scenarioIdAttribute(),
    ],
};
