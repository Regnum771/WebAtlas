import { Style, Stroke } from 'ol/style';
import type { FeatureLike } from 'ol/Feature';
import { LAYER_PALETTE } from '@webatlas/shared';
import { scaleAtResolution } from './zoomScale';

/**
 * The river network's style: a dark casing under a light core, graded by river size and zoom.
 *
 * Three things made the old style look blocky, and each has a rule here:
 *  1. Draw order. Casing and core were two plain styles, so OpenLayers drew them feature by
 *     feature: way 1's casing and core, then way 2's casing over the end of way 1's core. OSM ways
 *     are short (median ~700 m), so every join and every confluence got a dark notch. The casing
 *     now has zIndex 0 and the core zIndex 1: all casings are laid down before any core.
 *  2. Size. Widths came from the way's OSM rank, and OSM tags most mountain streams
 *     waterway=river, so nearly every line drew as a main river. Widths now come from the Strahler
 *     order (1-6, HydroRIVERS) of the river the way belongs to, sent by the API as `riverOrder`.
 *  3. Zoom. Widths were fixed in pixels, so at 1:1,000,000 a main river was 7 px (~2 km) wide and
 *     meanders merged into worms. Widths now grow with zoom.
 */

/** A river's size class: 3 = major (Strahler 5-6), 2 = large (4), 1 = medium (3), 0 = small (1-2). */
export type RiverClass = 0 | 1 | 2 | 3;

/** OSM waterway ranks carried as `streamOrder` (packages/shared/src/osm-water.ts). */
const RANK_RIVER = 5;
const RANK_CANAL = 4;
const RANK_STREAM = 2;

function classOfStrahler(order: number): RiverClass {
  if (order >= 5) return 3;
  if (order === 4) return 2;
  if (order === 3) return 1;
  return 0;
}

/**
 * The size class of one feature. With a Strahler order (official tiles), it decides, capped by the
 * OSM kind: a stream (rank 2) is at most medium, a canal (rank 4) at most large, a ditch (rank 1 or
 * below) small. A feature with no rank at all (the far-zoom overview's level-1 rivers) is not capped.
 * Without an order (an edit copy in a personal map, which has no parent river), the OSM rank alone
 * decides, and never as a major river: the rank cannot tell a main river from a hill stream.
 */
export function riverClassOf(feature: Pick<FeatureLike, 'get'>): RiverClass {
  const rank = Number(feature.get('streamOrder'));
  const order = Number(feature.get('riverOrder'));
  const hasRank = Number.isFinite(rank) && rank > 0;
  const cap: RiverClass = !hasRank || rank >= RANK_RIVER ? 3 : rank === RANK_CANAL ? 2 : rank >= RANK_STREAM ? 1 : 0;
  if (Number.isFinite(order) && order > 0) return Math.min(classOfStrahler(order), cap) as RiverClass;
  return Math.min(cap, 2) as RiverClass;
}

/**
 * A ">= threshold" comparison with a tolerance: the thresholds sit exactly on stops of the scale
 * slider, and the round trip zoom -> resolution -> scale returns 999,999.9999... for 1,000,000.
 * A thousandth of a denominator unit is far below anything meaningful and far above that error.
 */
function atLeast(scale: number, threshold: number): boolean {
  return scale >= threshold - 0.001;
}

/**
 * The smallest class still drawn at a resolution (a LARGER denominator is MORE zoomed out). The
 * classes drawn are always one unbroken run from the top down, so one number says it all and no
 * Set is allocated in a style function that runs for every feature on every frame.
 */
export function minRiverClassAt(resolution: number): RiverClass {
  const scale = scaleAtResolution(resolution);
  if (atLeast(scale, 2_000_000)) return 3; // major rivers only
  if (atLeast(scale, 1_000_000)) return 2; // + large
  if (atLeast(scale, 500_000)) return 1; // + medium
  return 0; // + small streams, canals, ditches
}

/** Core width (px) per class at zooms 7, 10 and 13; linear in between, flat outside. */
const CORE_WIDTH: Record<RiverClass, [number, number, number]> = {
  3: [1.6, 2.6, 4],
  2: [1.1, 1.8, 3],
  1: [0.8, 1.2, 2],
  0: [0.6, 0.8, 1.3],
};
const STOPS = [7, 10, 13] as const;

function interpolate([a, b, c]: [number, number, number], zoom: number): number {
  if (zoom <= STOPS[0]) return a;
  if (zoom <= STOPS[1]) return a + ((b - a) * (zoom - STOPS[0])) / (STOPS[1] - STOPS[0]);
  if (zoom <= STOPS[2]) return b + ((c - b) * (zoom - STOPS[1])) / (STOPS[2] - STOPS[1]);
  return c;
}

/** The web-mercator zoom of a resolution (156543.03 m/px at zoom 0). */
function zoomOf(resolution: number): number {
  return Math.log2(156543.03392804097 / resolution);
}

/** Widths change in half-zoom steps, so the style cache stays small (about 4 classes x 20 steps). */
function zoomStep(resolution: number): number {
  return Math.round(zoomOf(resolution) * 2) / 2;
}

export function riverWidths(cls: RiverClass, resolution: number): { core: number; casing: number } {
  const zoom = zoomStep(resolution);
  const core = Math.round(interpolate(CORE_WIDTH[cls], zoom) * 10) / 10;
  // The casing is a thin edge, wider once there is room for it.
  const casing = core + (zoom < 10 ? 1 : 1.6);
  return { core, casing };
}

const CASING_COLOUR = '#1e3a8a';
const styleCache = new Map<string, Style[]>();
const selectCache = new Map<string, Style[]>();

function pair(cache: Map<string, Style[]>, key: string, make: () => Style[]): Style[] {
  let styles = cache.get(key);
  if (!styles) {
    styles = make();
    cache.set(key, styles);
  }
  return styles;
}

/**
 * The river network's style function. Returns undefined, which OpenLayers reads as "do not draw",
 * for a class below the current zoom's threshold (undefined, not null: ol's StyleFunction type is
 * Style | Style[] | void). This is display level of detail only; the data is all there.
 */
export const riversStyle = (feature: FeatureLike, resolution: number): Style[] | undefined => {
  const cls = riverClassOf(feature);
  if (cls < minRiverClassAt(resolution)) return undefined;
  const { core, casing } = riverWidths(cls, resolution);
  return pair(styleCache, `${core}|${casing}`, () => [
    new Style({ zIndex: 0, stroke: new Stroke({ color: CASING_COLOUR, width: casing }) }),
    new Style({ zIndex: 1, stroke: new Stroke({ color: LAYER_PALETTE.layer_rivers.color, width: core }) }),
  ]);
};

/**
 * The highlight of a clicked river (applied through withHighlight in waterTiles.ts): a yellow halo
 * round a red core, above every casing and core of the network (zIndex 2 and 3).
 */
export function makeRiverSelectStyle() {
  return (feature: FeatureLike, resolution: number): Style[] => {
    const { core, casing } = riverWidths(riverClassOf(feature), resolution);
    return pair(selectCache, `${core}|${casing}`, () => [
      new Style({ zIndex: 2, stroke: new Stroke({ color: '#fde047', width: casing + 4 }) }),
      new Style({ zIndex: 3, stroke: new Stroke({ color: '#ef4444', width: core + 2 }) }),
    ]);
  };
}
