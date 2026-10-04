import { SEED_LAYER_COLUMNS, type ColumnMap } from '@webatlas/shared';
import { defineDataset } from '../schema';
import { allOf, viewCount, wfsAnswers } from '../probes';
import type { Dataset, Lineage } from '../types';

/**
 * The seven thematic layers, one dataset each (spec §10): one load-geojson, one publish. Each
 * depends on admin_boundaries, whose codes activation stamps onto every feature. The dataset id is
 * the layer key, so `--supersede-edits dams` names the layer it is about.
 */
function thematic(
  layer: keyof typeof SEED_LAYER_COLUMNS,
  file: string,
  legacySource: string,
  lineage: Lineage,
  opts: { multiPolygon?: boolean } = {}
): Dataset {
  return defineDataset({
    id: layer,
    kind: 'vector',
    editable: true,
    dependsOn: ['admin_boundaries'],
    lineage,
    stages: [
      {
        type: 'load-geojson',
        layer,
        versioned: true,
        legacySource,
        files: [{ file: `seeds/${file}`, columns: SEED_LAYER_COLUMNS[layer] as ColumnMap, ...opts }],
      },
      { type: 'publish-geoserver', layer },
    ],
    probe: allOf(viewCount(layer), wfsAnswers(layer)),
  });
}

const SYNTHETIC = 'LicenseRef-webatlas-synthetic';
const synthetic = (what: string): Lineage => ({
  statement: `${what}: dữ liệu minh hoạ tổng hợp từ nguyên mẫu ban đầu, không phải số đo thực địa.`,
  licence: SYNTHETIC,
  sources: [{ citation: 'Synthetic demonstration data from the original prototype — not measurements', licence: SYNTHETIC }],
});

export const dams = thematic('dams', 'dams.geojson', 'thuydienvietnam.geojson', {
  statement:
    'Đập thuỷ điện Việt Nam tính đến tháng 10/2020, cắt theo sáu tỉnh vùng công tác; trạng thái vận hành là giá trị minh hoạ.',
  licence: 'CC-BY-SA-4.0',
  sources: [
    {
      citation: 'Open Development Vietnam, Hydropower plants in Vietnam by October 2020',
      licence: 'CC-BY-SA-4.0',
      uri: 'https://data.opendevelopmentmekong.net/en/dataset/hydropower-plants-in-vietnam-by-october-2020',
    },
  ],
});

export const stations = thematic('stations', 'stations.geojson', 'stations.geojson', synthetic('Trạm quan trắc'));
export const floodZones = thematic('flood_zones', 'flood_zones.geojson', 'flood_zones.geojson', synthetic('Vùng ngập lụt'), { multiPolygon: true });
export const droughtPoints = thematic('drought_points', 'drought_points.geojson', 'drought_points.geojson', synthetic('Điểm hạn hán'));
export const saltwaterIntrusion = thematic('saltwater_intrusion', 'saltwater_intrusion.geojson', 'saltwater_intrusion.geojson', synthetic('Xâm nhập mặn'));
export const floodGeneration = thematic('flood_generation', 'flood_generation.geojson', 'flood_generation.geojson', synthetic('Vùng sinh lũ'), { multiPolygon: true });

export const lakes = thematic('lakes', 'osm-lakes-region.geojson', 'OSM water bodies', {
  statement: 'Hồ và hồ chứa từ OpenStreetMap, cắt theo sáu tỉnh vùng công tác; có tên hồ, không có dung tích và chiều dài bờ.',
  licence: 'ODbL-1.0',
  sources: [{ citation: 'OpenStreetMap contributors (water bodies)', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' }],
}, { multiPolygon: true });
