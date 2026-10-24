import { VALID_FROM, nameAttribute, osmIdAttribute } from './common.js';
export const osm_water = {
    key: 'osm_water',
    kind: 'vector',
    name: 'Mặt nước nền',
    definition: 'Mặt nước và đất ngập nước của nền bản đồ, nhập từ OpenStreetMap, vẽ theo đường bờ.',
    table: 'basemap.water_region',
    crs: 4326,
    // The column is a generic GEOMETRY holding Polygon and MultiPolygon; a Polygon is a one-part MultiPolygon.
    geometryType: 'MultiPolygon',
    geometryMeaning: 'exact',
    validFrom: VALID_FROM,
    attributes: [
        {
            // Stored as int4, but a class code, not a quantity: text, so it shows without separators.
            name: 'code',
            source: 'column',
            valueType: 'text',
            label: 'Mã loại',
            definition: 'Mã số bốn chữ số của loại mặt nước trong bộ dữ liệu OpenStreetMap của Geofabrik, ứng một-một với loại mặt nước.',
            validFrom: VALID_FROM,
        },
        {
            // Open: in apps/web and packages/shared only DynamicPopup's FCLASS_LABELS reads these codes,
            // as a label lookup that falls back to the raw code; no behaviour depends on them.
            name: 'fclass',
            source: 'column',
            valueType: 'code',
            label: 'Loại',
            definition: 'Loại mặt nước theo phân loại OpenStreetMap của Geofabrik.',
            codeList: 'open',
            values: [
                { code: 'water', name: 'Mặt nước', order: 1 },
                { code: 'reservoir', name: 'Hồ chứa', order: 2 },
                { code: 'riverbank', name: 'Lòng sông', order: 3 },
                { code: 'dock', name: 'Âu tàu', order: 4 },
                { code: 'wetland', name: 'Đất ngập nước', order: 5 },
                { code: 'wetland_marsh', name: 'Đầm lầy', order: 6 },
                { code: 'wetland_mangrove', name: 'Rừng ngập mặn', order: 7 },
                { code: 'wetland_tidalflat', name: 'Bãi triều', order: 8 },
                { code: 'wetland_reedbed', name: 'Bãi sậy', order: 9 },
                { code: 'wetland_swamp', name: 'Đầm lầy có cây', order: 10 },
                { code: 'wetland_wet_meadow', name: 'Đồng cỏ ngập nước', order: 11 },
            ],
            validFrom: VALID_FROM,
        },
        nameAttribute('Tên mặt nước theo OpenStreetMap, nếu có.'),
        osmIdAttribute(),
    ],
};
