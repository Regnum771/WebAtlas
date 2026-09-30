import { defineDataset } from '../schema';
import { allOf, rowCount, wfsAnswers } from '../probes';

/**
 * Sông ba cấp trong MỘT phiên bản: đường thuỷ OSM (cấp 3), đoạn HydroRIVERS (cấp 2), và
 * sông có tên (cấp 1) mà versionsService.activate() dựng lại khi phiên bản được kích hoạt.
 *
 * Id là khoá lớp `rivers` chứ không phải `hydrorivers` (spec C-9): hàng trạng thái cũ
 * dưới id `hydrorivers` chỉ có trên máy dev và vô hại.
 *
 * Còn là cửa thoát `run` cho tới khi load-geojson có (Plan C, spec §11). Lệnh chạy trên
 * máy chủ qua npm, không qua shell. Phụ thuộc `seeds`: ingest gán mã hành chính theo ranh giới
 * tỉnh/xã mà `seeds` nạp.
 */
export const rivers = defineDataset({
  id: 'rivers',
  kind: 'vector',
  editable: true,
  dependsOn: ['seeds'],
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
      type: 'run',
      in: 'host',
      argv: ['run', 'ingest:rivers', '-w', '@webatlas/api'],
      produces: 'water.rivers (levels 1-3) + app.dataset_versions row',
      promoteTo: 'load-geojson',
      promoteBy: '2026-12-31',
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
