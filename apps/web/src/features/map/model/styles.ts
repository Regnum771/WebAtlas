import { Style, Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
import { scaleAtResolution } from './zoomScale';
import type { ReservoirFilterType } from './MapModel';
import { DAM_STATUS_DISPLAY, toDamStatusSlug, type DamStatusSlug, LAYER_PALETTE } from '@webatlas/shared';

// LAYER_PALETTE (packages/shared) holds the raw '#rrggbb' identity colors so the
// legend and the map can't silently diverge; opacity variants are still built
// here, since OL Style/Fill objects and translucency are a map-only concern.
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Bucket (from riverBucket, by OSM waterway rank) -> [casing width, core width]. The higher the bucket, the wider.
// Bucket 0 is the thin default for "ditch / everything else".
const RIVER_WIDTHS: Record<number, [number, number]> = {
  3: [7, 3.5],   // main river
  2: [5, 2.2],   // canal
  1: [3, 1.2],   // stream
  0: [1.5, 0.5], // ditch / unknown
};

// Rank by OSM kind (see packages/shared/src/osm-water.ts):
// 5 = main river, 4 = canal, 2 = stream, 1 = ditch.
function riverBucket(order: number): 0 | 1 | 2 | 3 {
  if (order >= 5) return 3;
  if (order === 4) return 2;
  if (order === 3 || order === 2) return 1;
  return 0;
}

// Precompute the 4 style arrays once at module load.
const RIVER_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    return [
      b,
      [
        new Style({ stroke: new Stroke({ color: '#1e3a8a', width: borderWidth }) }),
        new Style({ stroke: new Stroke({ color: LAYER_PALETTE.layer_rivers.color, width: mainWidth }) }),
      ],
    ];
  })
);

/**
 * A ">= threshold" comparison with a tolerance, because the three thresholds below
 * (1,000,000, 500,000 and 250,000) sit EXACTLY on three stops of the slider. Going
 * round through zoomForScale -> resolution -> scaleAtResolution, the denominator
 * 1,000,000 comes back as 999,999.9999..., so a strict comparison would give a
 * different level of detail at a stop the user can click to: behaviour that depends
 * on floating-point noise. A thousandth of a denominator unit is far below anything
 * meaningful and far above the rounding error (~1e-4 at the 1e6 scale).
 */
function atLeast(scale: number, threshold: number): boolean {
  return scale >= threshold - 0.001;
}

/**
 * The smallest bucket still drawn at a resolution. The higher the bucket, the larger
 * the river, and the buckets shown are always one unbroken run from the top down, so
 * a single number expresses the whole threshold table: no Set is allocated in a style
 * function that runs for every feature on every frame.
 *
 * A LARGER denominator means MORE zoomed out.
 */
export function minRiverBucketAt(resolution: number): 0 | 1 | 2 | 3 {
  const scale = scaleAtResolution(resolution);
  if (atLeast(scale, 1_000_000)) return 3; // main rivers only
  if (atLeast(scale, 500_000)) return 2; // + canals
  if (atLeast(scale, 250_000)) return 1; // + streams
  return 0; // + ditches, unknown
}

// The style of the river network, by river rank — cached, no per-frame allocation.
// Returns undefined for buckets below the current zoom's threshold: OpenLayers reads
// "no style" as "do not draw the feature". It must be undefined, not null: ol's
// StyleFunction type is declared to return Style | Style[] | void, so null breaks the
// type-check where the style is assigned to the layer (MapModel.ts).
// This is DISPLAY level of detail: the data is still all there, only the drawing is lighter.
export const riversStyle = (feature: any, resolution: number) => {
  const cap = feature.get('streamOrder') || 6;
  const bucket = riverBucket(cap);
  if (bucket < minRiverBucketAt(resolution)) return undefined;
  return RIVER_STYLES[bucket];
};

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


// Province boundaries (after the 2025 merger). A tile holds the polygons (MVT layer `provinces`) and
// one label point per province (MVT layer `province_labels`, placed by the API on the province's
// largest part): only the points draw text, so a province cut by several tiles is labelled once.
const PROVINCE_OUTLINE = new Style({
  // A TRANSPARENT fill, not none: the decorative pastel fills are gone (see the ARCHIVED note above),
  // but OpenLayers needs a fill to hit-test the INSIDE of a polygon; without one a province could
  // only be clicked exactly on its outline.
  fill: new Fill({ color: 'rgba(0,0,0,0)' }),
  stroke: new Stroke({ color: LAYER_PALETTE.layer_provinces_2026.color, width: 2.5 }),
});

export const provincesStyle = (feature: any) => {
  if (feature.get('layer') !== 'province_labels') return PROVINCE_OUTLINE;
  return new Style({
    text: new Text({
      text: feature.get('name') || '',
      font: 'bold 12px Inter, system-ui, sans-serif',
      fill: new Fill({ color: '#312e81' }),
      stroke: new Stroke({ color: '#ffffff', width: 4 }),
    }),
  });
};


// Ward boundaries (after the 2025 merger): dashed, faint outline. A tile holds the polygons
// (MVT layer `wards`) and one label point per ward (MVT layer `ward_labels`): only the points draw text,
// so a ward cut by several tiles is labelled once.
const WARD_OUTLINE = new Style({
  // Transparent — see the note on PROVINCE_OUTLINE for why the fill stays.
  fill: new Fill({ color: 'rgba(0,0,0,0)' }),
  stroke: new Stroke({ color: hexToRgba(LAYER_PALETTE.layer_wards_2026.color, 0.4), width: 1, lineDash: [4, 4] }),
});

export const wardsStyle = (feature: any) => {
  if (feature.get('layer') !== 'ward_labels') return WARD_OUTLINE;
  return new Style({
    text: new Text({
      text: feature.get('name') || '',
      font: 'normal 10.5px Inter, system-ui, sans-serif',
      fill: new Fill({ color: '#374151' }),
      stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
      overflow: false,
      padding: [1, 2, 1, 2]
    })
  });
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
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
    });
    damStyleCache.set(key, style);
  }
  return style;
}

// Cartodiagram: size ~ ratedPower, color ~ operational status (real DB slug, stamped at load).
// Reads the pre-computed statusSlug (Task 4); does NOT mutate the feature or derive status from id.
export function makeDamsStyle(getReservoirFilter: () => ReservoirFilterType) {
  return (feature: any): Style | undefined => {
    const slug = toDamStatusSlug(feature.get('statusSlug'));

    const currentFilter = getReservoirFilter();
    if (currentFilter !== 'all' && currentFilter !== slug) return undefined;

    const wattage = feature.get('ratedPower') || 50;
    const radius = Math.round(Math.max(6, Math.min(18, 6 + wattage / 180)));
    return damStyle(slug, radius);
  };
}

// Highlight styles (cached) for ol/interaction/Select on rivers.
const RIVER_SELECT_STYLES: Record<number, Style[]> = Object.fromEntries(
  ([0, 1, 2, 3] as const).map((b) => {
    const [borderWidth, mainWidth] = RIVER_WIDTHS[b];
    return [
      b,
      [
        new Style({ stroke: new Stroke({ color: '#fde047', width: borderWidth + 4 }) }),
        new Style({ stroke: new Stroke({ color: '#ef4444', width: mainWidth + 2 }) }),
      ],
    ];
  })
);

// The highlight style of a clicked river segment (applied through withHighlight in waterTiles.ts).
export function makeRiverSelectStyle() {
  return (feature: any) => {
    const cap = feature.get('streamOrder') || 6;
    return RIVER_SELECT_STYLES[riverBucket(cap)];
  };
}
