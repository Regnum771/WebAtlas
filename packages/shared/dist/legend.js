import { DAM_STATUS_SLUGS, DAM_STATUS_DISPLAY } from './dam-status.js';
import { LAYER_PALETTE } from './layer-palette.js';
/** Attribution required by the data licence, keyed by layerStateId.
 *  OSM data is ODbL and MUST carry this wherever the layer is shown. */
export const LEGEND_ATTRIBUTION = {
    layer_rivers: '© OpenStreetMap contributors (ODbL)',
    layer_lakes: '© OpenStreetMap contributors (ODbL)',
};
const CAPACITY_ENTRIES = [
    { swatch: '#6b7280', shape: 'dot', size: 6, label: 'Nhỏ (< 200 MW)' },
    { swatch: '#6b7280', shape: 'dot', size: 11, label: 'Vừa (200 – 1000 MW)' },
    { swatch: '#6b7280', shape: 'dot', size: 16, label: 'Lớn (> 1000 MW)' },
];
/** Legend sections for a layer. Adding a layer means adding a case here —
 *  no JSX branches, no inline styles. */
export function legendFor(layerStateId) {
    switch (layerStateId) {
        case 'layer_dams':
            return [
                {
                    title: 'Theo Trạng thái',
                    entries: DAM_STATUS_SLUGS.map((slug) => ({
                        swatch: DAM_STATUS_DISPLAY[slug].color,
                        shape: 'dot',
                        label: DAM_STATUS_DISPLAY[slug].label,
                    })),
                },
                { title: 'Theo Công suất', entries: CAPACITY_ENTRIES },
            ];
        case 'layer_rivers':
            return [{ title: 'Sông ngòi', entries: [{ swatch: LAYER_PALETTE.layer_rivers.color, shape: 'line', label: 'Dòng chảy' }] }];
        case 'layer_lakes':
            return [{ title: 'Hồ', entries: [{ swatch: LAYER_PALETTE.layer_lakes.color, shape: 'box', label: 'Mặt nước' }] }];
        case 'layer_stations':
            return [{ title: 'Trạm quan trắc', entries: [{ swatch: LAYER_PALETTE.layer_stations.color, shape: 'dot', label: 'Trạm' }] }];
        case 'layer_flood':
            return [{ title: 'Ngập lụt', entries: [{ swatch: LAYER_PALETTE.layer_flood.color, shape: 'box', label: 'Vùng ngập' }] }];
        case 'layer_drought_survey':
            return [{ title: 'Hạn hán', entries: [{ swatch: LAYER_PALETTE.layer_drought_survey.color, shape: 'dot', label: 'Điểm khảo sát' }] }];
        case 'layer_saltwater_intrusion':
            return [{ title: 'Xâm nhập mặn', entries: [{ swatch: LAYER_PALETTE.layer_saltwater_intrusion.color, shape: 'dot', label: 'Điểm đo mặn' }] }];
        case 'layer_flood_generation':
            return [{ title: 'Sinh lũ', entries: [{ swatch: LAYER_PALETTE.layer_flood_generation.color, shape: 'box', label: 'Vùng sinh lũ' }] }];
        case 'layer_provinces_2026':
            return [{
                    title: 'Ranh giới tỉnh',
                    entries: [{ swatch: LAYER_PALETTE.layer_provinces_2026.color, shape: 'line', label: 'Đường ranh giới' }],
                    note: 'Màu nền mỗi tỉnh chỉ để phân biệt trực quan, không mang ý nghĩa dữ liệu.',
                }];
        case 'layer_wards_2026':
            return [{
                    title: 'Ranh giới xã/phường',
                    entries: [{ swatch: LAYER_PALETTE.layer_wards_2026.color, shape: 'line', label: 'Đường ranh giới' }],
                    note: 'Màu nền mỗi xã/phường chỉ để phân biệt trực quan, không mang ý nghĩa dữ liệu.',
                }];
        default:
            return [];
    }
}
