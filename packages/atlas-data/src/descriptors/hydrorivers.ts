import { defineDataset } from '../schema';

/**
 * Đoạn sông HydroRIVERS (cấp 2) cùng đường thuỷ OSM (cấp 3), và phân cấp sông dẫn xuất
 * (cấp 1) mà versionsService.activate() dựng lại khi phiên bản được kích hoạt.
 *
 * Khai báo là cửa thoát `run` chứ không phải stage `load-geojson`, vì runner.ts hiện chỉ
 * cài đặt stage `sql` — `load-geojson` mới được khai báo trong types.ts và thuộc về mạch
 * sổ đăng ký dữ liệu. assertNoOverdueEscapeHatches biến promoteBy thành lỗi build, nên
 * cửa thoát này không thể lặng lẽ trở thành vĩnh viễn.
 *
 * Hệ quả cần biết: runner cũng CHƯA thực thi stage `run`, nên `npm run atlas:build` không
 * đối số sẽ báo tập này thất bại cho tới khi mạch sổ đăng ký cài đặt nó. Dùng
 * `--except hydrorivers`; bản thân dữ liệu vẫn nạp bằng lệnh ở `command` bên dưới.
 */
export const hydrorivers = defineDataset({
  id: 'hydrorivers',
  kind: 'vector',
  editable: true,
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
      command: 'npm run ingest:rivers -w @webatlas/api',
      produces: 'water.rivers (levels 1-3) + app.dataset_versions row',
      promoteTo: 'load-geojson',
      promoteBy: '2026-12-31',
    },
  ],
});
