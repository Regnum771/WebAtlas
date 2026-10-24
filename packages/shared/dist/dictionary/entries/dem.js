import { VALID_FROM } from './common.js';
export const dem = {
    key: 'dem',
    kind: 'raster',
    name: 'Mô hình số độ cao',
    definition: 'Lưới độ cao mặt đất trần FABDEM V1-2 (đã loại bỏ cây và nhà), độ phân giải khoảng 30 m.',
    table: 'basemap.dem_region',
    // ST_SRID of basemap.dem_region is 4326: the DEM stays in the vector layers' CRS, not 3857.
    crs: 4326,
    geometryMeaning: 'exact',
    validFrom: VALID_FROM,
    attributes: [
        {
            name: '1',
            source: 'band',
            valueType: 'number',
            label: 'Độ cao',
            definition: 'Độ cao mặt đất so với mặt geoid EGM2008.',
            storedUnit: 'm',
            displayUnits: ['m'],
            displayUnit: 'm',
            // The cursor readout rounds to the metre: a 30 m grid has no meaningful decimals.
            precision: 0,
            cfStandardName: 'surface_altitude',
            // ST_BandNoDataValue(rast, 1) on every tile of basemap.dem_region.
            nodata: -9999,
            validFrom: VALID_FROM,
        },
    ],
};
