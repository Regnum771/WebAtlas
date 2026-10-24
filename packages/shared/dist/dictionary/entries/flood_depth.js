import { VALID_FROM } from './common.js';
/**
 * PNG frames, one per scenario hour, not a table (Ruling 3). A frame encodes depth in 0.25 m
 * steps up to 4 m and is transparent where dry, so the band has no numeric nodata
 * (apps/web/src/features/flood-scenario/model/depthColour.ts).
 */
export const flood_depth = {
    key: 'flood_depth',
    kind: 'raster',
    name: 'Độ sâu ngập theo kịch bản',
    definition: 'Ảnh độ sâu ngập theo từng giờ của mỗi kịch bản lũ trên Vu Gia – Thu Bồn, mô phỏng nhanh trên FABDEM.',
    crs: 3857,
    geometryMeaning: 'exact',
    validFrom: VALID_FROM,
    attributes: [
        {
            // No CF standard name fits inland flood depth.
            name: '1',
            source: 'band',
            valueType: 'number',
            label: 'Độ sâu ngập',
            definition: 'Độ sâu nước trên mặt đất, làm tròn tới 0,25 m, mọi độ sâu từ 4 m trở lên ghi là 4 m.',
            storedUnit: 'm',
            displayUnits: ['m', 'cm'],
            displayUnit: 'm',
            precision: 2,
            validFrom: VALID_FROM,
        },
    ],
};
