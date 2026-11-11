import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import type { StyleLike } from 'ol/style/Style';
import { scaleAtResolution } from './zoomScale';
import type { ReservoirFilterType } from './MapModel';
import { DAM_STATUS_DISPLAY, toDamStatusSlug, type DamStatusSlug, type EditableLayerKey, LAYER_PALETTE } from '@webatlas/shared';

// LAYER_PALETTE (packages/shared) holds the raw '#rrggbb' identity colors so the
// legend and the map can't silently diverge; opacity variants are still built
// here, since OL Style/Fill objects and translucency are a map-only concern.
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The river network's style lives in riverStyle.ts (size classes, zoom-graded widths, draw order).
import { riversStyle, makeRiverSelectStyle, minRiverClassAt } from './riverStyle';
export { riversStyle, makeRiverSelectStyle, minRiverClassAt };

/**
 * A ">= threshold" comparison with a tolerance: thresholds sit exactly on stops of the scale slider,
 * and the round trip zoom -> resolution -> scale returns 999,999.9999... for 1,000,000.
 */
function atLeast(scale: number, threshold: number): boolean {
  return scale >= threshold - 0.001;
}

export const stationsStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: LAYER_PALETTE.layer_stations.color }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const floodStyle = new Style({
  fill: new Fill({ color: hexToRgba(LAYER_PALETTE.layer_flood.color, 0.25) }),
  stroke: new Stroke({ color: LAYER_PALETTE.layer_flood.color, width: 1.5 })
});

export const lakesStyle = new Style({
  fill: new Fill({ color: hexToRgba(LAYER_PALETTE.layer_lakes.color, 0.35) }),  // sky-400, translucent water
  stroke: new Stroke({ color: LAYER_PALETTE.layer_lakes.stroke, width: 1 }),      // sky-600 shoreline
});

export const droughtSurveyStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: LAYER_PALETTE.layer_drought_survey.color }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const saltwaterIntrusionStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: LAYER_PALETTE.layer_saltwater_intrusion.color }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 })
  })
});

export const floodGenerationStyle = new Style({
  fill: new Fill({ color: hexToRgba(LAYER_PALETTE.layer_flood_generation.color, 0.2) }),
  stroke: new Stroke({ color: LAYER_PALETTE.layer_flood_generation.color, width: 1.5 })
});

// ARCHIVED: the pastel fills of provinces and wards were removed (the self-hosted basemap
// already gives the context, and decorative colours competed with the DATA colours of the
// hazard layers). To restore them: `git show b84bf50:apps/web/src/features/map/model/styles.ts`,
// which holds provinceColors[] and the hashCode() function that picks a colour from the ward code.


// Province boundaries (after the 2025 merger). A tile holds three MVT layers:
//  - `provinces`: the polygons, drawn with a transparent fill and NO stroke. The fill stays (not none)
//    because OpenLayers needs one to hit-test the INSIDE of a polygon. Stroking them would outline the
//    coast and ring every island at sea;
//  - `province_borders`: the land boundaries the map strokes (API migration 34), kind 'province'
//    (between two provinces) or 'national' (the land border with China, Laos and Cambodia);
//  - `province_labels`: one point per province on its largest part, so a province is labelled once.
// Labels are drawn by a separate layer above all data (boundaryLabels.ts), so these styles split
// into the lines (provincesStyle) and the text (provinceLabelStyle).
const PROVINCE_AREA = new Style({ fill: new Fill({ color: 'rgba(0,0,0,0)' }) });
const PROVINCE_BORDER = new Style({
  stroke: new Stroke({ color: LAYER_PALETTE.layer_provinces_2026.color, width: 2 }),
});
const NATIONAL_BORDER = new Style({
  stroke: new Stroke({ color: LAYER_PALETTE.layer_provinces_2026.color, width: 3 }),
});

export const provincesStyle = (feature: any): Style | undefined => {
  const layer = feature.get('layer');
  if (layer === 'province_labels') return undefined;
  if (layer === 'province_borders') return feature.get('kind') === 'national' ? NATIONAL_BORDER : PROVINCE_BORDER;
  return PROVINCE_AREA;
};

const provinceLabelCache = new Map<string, Style>();
export const provinceLabelStyle = (feature: any): Style | undefined => {
  if (feature.get('layer') !== 'province_labels') return undefined;
  const name = feature.get('name') || '';
  let style = provinceLabelCache.get(name);
  if (!style) {
    style = new Style({
      text: new Text({
        text: name,
        font: 'bold 12px Inter, system-ui, sans-serif',
        fill: new Fill({ color: '#312e81' }),
        stroke: new Stroke({ color: '#ffffff', width: 4 }),
      }),
    });
    provinceLabelCache.set(name, style);
  }
  return style;
};


// Ward boundaries (after the 2025 merger). A tile holds the polygons (MVT layer `wards`) and one label
// point per ward (`ward_labels`), so a ward cut by several tiles is labelled once. The outline used to
// be a 1 px grey dash at 40 % opacity, which read as a footpath on the OSM basemap (its tracks are grey
// dashes too); it is now an indigo dash, the provinces' hue, so the two boundary levels read as a family.
const WARD_OUTLINE = new Style({
  // Transparent fill: see PROVINCE_AREA for why it stays.
  fill: new Fill({ color: 'rgba(0,0,0,0)' }),
  stroke: new Stroke({ color: hexToRgba(LAYER_PALETTE.layer_wards_2026.color, 0.75), width: 1.4, lineDash: [6, 3] }),
});

export const wardsStyle = (feature: any): Style | undefined => {
  if (feature.get('layer') === 'ward_labels') return undefined;
  return WARD_OUTLINE;
};

const wardLabelCache = new Map<string, Style>();
export const wardLabelStyle = (feature: any): Style | undefined => {
  if (feature.get('layer') !== 'ward_labels') return undefined;
  const name = feature.get('name') || '';
  let style = wardLabelCache.get(name);
  if (!style) {
    style = new Style({
      text: new Text({
        text: name,
        font: 'normal 10.5px Inter, system-ui, sans-serif',
        fill: new Fill({ color: '#374151' }),
        stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
        overflow: false,
        padding: [1, 2, 1, 2],
      }),
    });
    wardLabelCache.set(name, style);
  }
  return style;
};

// Cache CircleStyle by `${slug}|${radius}` — bounded (3 slugs x ~13 integer radii).
const damStyleCache = new Map<string, Style>();

function damStyle(slug: DamStatusSlug, radius: number): Style {
  const key = `${slug}|${radius}`;
  let style = damStyleCache.get(key);
  if (!style) {
    style = new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: DAM_STATUS_DISPLAY[slug].color }),
        // A 2 px rim would swallow a far-zoom marker of radius 3-4.
        stroke: new Stroke({ color: '#ffffff', width: radius < 5 ? 1 : 2 }),
      }),
    });
    damStyleCache.set(key, style);
  }
  return style;
}

/**
 * How much of its full size a dam marker keeps at a resolution. At 1:4,000,000 full-size markers
 * (6-18 px) piled into solid clusters over the highland provinces; far out they shrink so each
 * dam stays a separate dot. A LARGER denominator is MORE zoomed out.
 */
export function damMarkerScaleAt(resolution: number | undefined): number {
  if (resolution === undefined) return 1;
  const scale = scaleAtResolution(resolution);
  if (atLeast(scale, 2_000_000)) return 0.45;
  if (atLeast(scale, 1_000_000)) return 0.65;
  if (atLeast(scale, 500_000)) return 0.85;
  return 1;
}

// Cartodiagram: size ~ ratedPower, color ~ operational status (real DB slug, stamped at load).
// Reads the pre-computed statusSlug (Task 4); does NOT mutate the feature or derive status from id.
export function makeDamsStyle(getReservoirFilter: () => ReservoirFilterType) {
  return (feature: any, resolution?: number): Style | undefined => {
    const slug = toDamStatusSlug(feature.get('statusSlug'));

    const currentFilter = getReservoirFilter();
    if (currentFilter !== 'all' && currentFilter !== slug) return undefined;

    const wattage = feature.get('ratedPower') || 50;
    const full = Math.max(6, Math.min(18, 6 + wattage / 180));
    const radius = Math.max(3, Math.round(full * damMarkerScaleAt(resolution)));
    return damStyle(slug, radius);
  };
}

/**
 * The style each editable layer's official map layer draws with (MapModel), so an edit copy
 * in a personal map is drawn like the layer it copies. Rivers leave out the clicked-river
 * highlight, and dams the reservoir status filter: both belong to the official layer only.
 * The styles read ISO property names (streamOrder, statusSlug, ratedPower).
 */
const damsAll = makeDamsStyle(() => 'all');
const OFFICIAL_STYLES: Record<EditableLayerKey, StyleLike> = {
  dams: damsAll,
  rivers: riversStyle,
  lakes: lakesStyle,
  stations: stationsStyle,
  flood_zones: floodStyle,
  drought_points: droughtSurveyStyle,
  saltwater_intrusion: saltwaterIntrusionStyle,
  flood_generation: floodGenerationStyle,
};
export function officialStyleFor(layerKey: EditableLayerKey): StyleLike {
  return OFFICIAL_STYLES[layerKey];
}
