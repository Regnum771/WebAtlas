import { ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS } from '@webatlas/shared';
import { defineDataset } from '../schema';
import { allOf, rowCount } from '../probes';

/**
 * Province and ward boundaries after the 2025-07-01 reorganisation. Non-versioned: a closed set
 * that is replaced whole. Every thematic layer depends on it, because activation stamps each
 * feature with the province and ward codes it intersects; a boundary change therefore cascades to
 * every layer's re-stamp path (spec §11).
 *
 * The two files live in data/seeds with the other committed inputs. They used to sit in
 * apps/web/public because the map loaded them there (spec C-2); it now draws both layers from
 * the API's vector tiles.
 */
export const adminBoundaries = defineDataset({
  id: 'admin_boundaries',
  kind: 'vector',
  lineage: {
    statement:
      'Ranh giới 34 tỉnh và các xã của sáu tỉnh vùng công tác sau sắp xếp 01/7/2025, giản lược khoảng 11 m ' +
      'bằng fetch-boundaries.mjs; dùng để gán mã hành chính cho mọi lớp chuyên đề.',
    licence: 'MIT',
    sources: [
      {
        citation: 'thanglequoc/vietnamese-provinces-database (dữ liệu gốc: NXB Tài nguyên – Môi trường và Bản đồ)',
        licence: 'MIT',
        uri: 'https://github.com/thanglequoc/vietnamese-provinces-database',
      },
    ],
  },
  stages: [
    {
      type: 'load-geojson',
      layer: 'admin',
      versioned: false,
      files: [
        { file: 'seeds/provinces-34.geojson', target: 'admin.provinces', multiPolygon: true, columns: ADMIN_PROVINCE_COLUMNS },
        { file: 'seeds/wards-region.geojson', target: 'admin.wards', multiPolygon: true, columns: ADMIN_WARD_COLUMNS },
      ],
    },
  ],
  probe: allOf(
    rowCount('admin.provinces', 'SELECT count(*)::text AS n FROM admin.provinces', 34),
    rowCount('admin.wards', 'SELECT count(*)::text AS n FROM admin.wards')
  ),
});
