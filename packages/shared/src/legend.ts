import { DAM_STATUS_SLUGS, DAM_STATUS_DISPLAY } from './dam-status.js';

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
export const LEGEND_ATTRIBUTION: Record<string, string> = {
  layer_rivers: '© OpenStreetMap contributors (ODbL)',
  layer_lakes: '© OpenStreetMap contributors (ODbL)',
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
      return [{ title: 'Sông ngòi', entries: [{ swatch: '#3b82f6', shape: 'line', label: 'Dòng chảy' }] }];
    case 'layer_lakes':
      return [{ title: 'Hồ', entries: [{ swatch: '#60a5fa', shape: 'box', label: 'Mặt nước' }] }];
    case 'layer_stations':
      return [{ title: 'Trạm quan trắc', entries: [{ swatch: '#f59e0b', shape: 'dot', label: 'Trạm' }] }];
    default:
      return [];
  }
}
