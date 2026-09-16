import { DAM_STATUS_SLUGS, DAM_STATUS_DISPLAY } from './dam-status.js';
import { LAYER_PALETTE } from './layer-palette.js';

export interface LegendEntry {
  swatch: string;
  shape: 'dot' | 'line' | 'box';
  label: string;
  /** Rendered diameter in px for 'dot' entries that encode magnitude. */
  size?: number;
}

export interface LegendSection {
  title: string;
  entries: LegendEntry[];
  note?: string;
}

/** Attribution required by the data licence, keyed by layerStateId.
 *  OSM data is ODbL and MUST carry this wherever the layer is shown. */
const OSM_ODBL = '© OpenStreetMap contributors (ODbL)';

/**
 * FABDEM (CC BY-NC-SA 4.0) attribution, required wherever elevation-derived data
 * surfaces. Kept as the exact sentence from docs/runbooks/elevation-dem.md and
 * terrain-contours.md — do not paraphrase, it is a licence condition.
 */
const FABDEM_ATTRIBUTION =
  'FABDEM is produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018';

export const LEGEND_ATTRIBUTION: Record<string, string> = {
  layer_rivers: OSM_ODBL,
  layer_lakes: OSM_ODBL,
  // MapModel.ts deliberately carries no ol/control/Attribution (see the comment at
  // MapModel.ts:368-370 — it collided with the toolbar and the bottom-right readouts),
  // so every `attributions` string passed to an OpenLayers source is inert. This legend
  // is the ONLY place any of these notices reach a user. That currently covers rivers,
  // lakes and the contour layer below; the basemap context layers (roads/railways/water/
  // landuse) and the OSM/Esri basemap tiles themselves are still uncovered — a known,
  // deliberately unfixed gap (see final-review-fixes.md C1), not an inconsistency to
  // "fix" by mechanically adding OSM_ODBL to every OSM-derived entry.
  layer_bm_roads: OSM_ODBL,
  layer_bm_railways: OSM_ODBL,
  layer_bm_water: OSM_ODBL,
  layer_bm_landuse: OSM_ODBL,
  layer_contours: FABDEM_ATTRIBUTION,
};

const CAPACITY_ENTRIES: LegendEntry[] = [
  { swatch: '#6b7280', shape: 'dot', size: 6, label: 'Nhỏ (< 200 MW)' },
  { swatch: '#6b7280', shape: 'dot', size: 11, label: 'Vừa (200 – 1000 MW)' },
  { swatch: '#6b7280', shape: 'dot', size: 16, label: 'Lớn (> 1000 MW)' },
];

/** Legend sections for a layer. Adding a layer means adding a case here —
 *  no JSX branches, no inline styles. */
export function legendFor(layerStateId: string): LegendSection[] {
  switch (layerStateId) {
    case 'layer_dams':
      return [
        {
          title: 'Theo Trạng thái',
          entries: DAM_STATUS_SLUGS.map((slug) => ({
            swatch: DAM_STATUS_DISPLAY[slug].color,
            shape: 'dot' as const,
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
      }];
    case 'layer_wards_2026':
      return [{
        title: 'Ranh giới xã/phường',
        entries: [{ swatch: LAYER_PALETTE.layer_wards_2026.color, shape: 'line', label: 'Đường ranh giới' }],
      }];
    // Lớp ngữ cảnh của nền bản đồ (raster GeoServer, dữ liệu OSM/ODbL).
    // Màu lấy từ LAYER_PALETTE — chính là giá trị mà styles.py đọc để sinh SLD,
    // nên ô màu trong chú giải không thể lệch khỏi thứ đang được vẽ.
    case 'layer_bm_roads':
      return [{
        title: 'Giao thông đường bộ',
        entries: [
          { swatch: LAYER_PALETTE.layer_bm_roads.color, shape: 'line', label: 'Đường bộ' },
        ],
        note: 'Đường lớn hiện ở mọi mức thu phóng; đường nhỏ chỉ hiện khi phóng to.',
      }];
    case 'layer_bm_railways':
      return [{
        title: 'Đường sắt',
        entries: [{ swatch: LAYER_PALETTE.layer_bm_railways.color, shape: 'line', label: 'Tuyến đường sắt' }],
      }];
    case 'layer_bm_water':
      return [{
        title: 'Mặt nước nền',
        entries: [{ swatch: LAYER_PALETTE.layer_bm_water.color, shape: 'box', label: 'Mặt nước' }],
        note: 'Nền tham chiếu từ OpenStreetMap — khác với lớp "Hồ & Hồ chứa" là dữ liệu chuyên đề.',
      }];
    case 'layer_bm_landuse':
      return [{
        title: 'Sử dụng đất',
        entries: [
          { swatch: LAYER_PALETTE.layer_bm_landuse.color, shape: 'box', label: 'Cây xanh, rừng' },
          { swatch: LAYER_PALETTE.layer_bm_landuse.secondary ?? LAYER_PALETTE.layer_bm_landuse.color, shape: 'box', label: 'Đất xây dựng' },
        ],
      }];
    default:
      return [];
  }
}
