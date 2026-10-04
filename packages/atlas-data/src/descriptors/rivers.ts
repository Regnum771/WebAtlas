import { RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS } from '@webatlas/shared';
import { defineDataset } from '../schema';
import { allOf, rowCount, wfsAnswers } from '../probes';

/**
 * Sông ba cấp trong MỘT phiên bản: đường thuỷ OSM (cấp 3), đoạn HydroRIVERS (cấp 2), và
 * sông có tên (cấp 1) mà versionsService.activate() dựng lại khi phiên bản được kích hoạt.
 *
 * Id là khoá lớp `rivers` chứ không phải `hydrorivers` (spec C-9): hàng trạng thái cũ
 * dưới id `hydrorivers` chỉ có trên máy dev và vô hại.
 *
 * Một load-geojson nạp HAI tệp vào MỘT phiên bản (spec C-6): một phiên bản ingest không có cha,
 * nên nạp hai cấp vào hai phiên bản thì một cấp sẽ biến mất với mọi người đọc. Phụ thuộc
 * `admin_boundaries`: kích hoạt gán mã tỉnh/xã theo ranh giới.
 */
export const rivers = defineDataset({
  id: 'rivers',
  kind: 'vector',
  editable: true,
  dependsOn: ['admin_boundaries'],
  lineage: {
    statement:
      'Đoạn sông HydroRIVERS v10 chọn theo sáu tỉnh vùng công tác, nối tên từ đường thuỷ OSM, ' +
      'dựng thành phân cấp sông ba cấp.',
    // The combined product is under the more restrictive of its two sources: OSM's ODbL
    // share-alike binds any database derived from it, including the level-1 rivers.
    licence: 'ODbL-1.0',
    sources: [
      {
        citation: 'HydroSHEDS HydroRIVERS v1.0 (Asia)',
        licence: 'CC-BY-4.0',
        uri: 'https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip',
        resolution: '15 arc-seconds',
      },
      { citation: 'OpenStreetMap waterways', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' },
    ],
  },
  stages: [
    {
      type: 'load-geojson',
      layer: 'rivers',
      versioned: true,
      legacySource: 'OSM waterways + HydroRIVERS v10',
      files: [
        { file: 'seeds/osm-rivers-region.geojson', columns: RIVER_WAY_COLUMNS, multiLine: true },
        { file: 'seeds/hydrorivers-region.geojson', columns: RIVER_REACH_COLUMNS, multiLine: true },
      ],
    },
    // rivers_detail, not rivers_active: water.rivers holds all three levels, so the active view
    // would draw every river as its ways, reaches and entity stacked together.
    { type: 'publish-geoserver', layer: 'rivers', nativeName: 'rivers_detail' },
    // The far-zoom overview: a plain view over level-1 rivers (entity phase 3). No `_active` suffix.
    { type: 'publish-geoserver', layer: 'rivers_overview', nativeName: 'rivers_overview' },
  ],
  probe: allOf(
    rowCount('level-1 rivers', 'SELECT count(*)::text AS n FROM water.rivers_active WHERE feature_level = 1'),
    wfsAnswers('rivers')
  ),
});
