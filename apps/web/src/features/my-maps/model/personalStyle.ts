import type { FeatureLike } from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import { toContext } from 'ol/render';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import { EDITABLE_LAYER_KEYS, normalizeFeatureProperties, toDamStatusSlug, type EditableLayerKey } from '@webatlas/shared';
import { officialStyleFor } from '../../map/model/styles';
import type { GeometryType, LayerSummary } from '../api/workspace.api';

/** How a free personal layer is drawn; stored in the layer's `style` JSON. */
export interface PersonalLayerStyle {
  color: string;
  width: number;
  fillOpacity: number;
  pointRadius: number;
}

export const DEFAULT_STYLE: PersonalLayerStyle = { color: '#d9480f', width: 2, fillOpacity: 0.25, pointRadius: 6 };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Reads a stored style key by key: a missing or bad value takes the default, unknown keys are dropped. */
export function parseStyle(raw: Record<string, unknown>): PersonalLayerStyle {
  const { color, width, fillOpacity, pointRadius } = raw ?? {};
  return {
    color: typeof color === 'string' && HEX_COLOR.test(color) ? color : DEFAULT_STYLE.color,
    width: finite(width) && width > 0 && width <= 20 ? width : DEFAULT_STYLE.width,
    fillOpacity: finite(fillOpacity) && fillOpacity >= 0 && fillOpacity <= 1 ? fillOpacity : DEFAULT_STYLE.fillOpacity,
    pointRadius: finite(pointRadius) && pointRadius > 0 && pointRadius <= 50 ? pointRadius : DEFAULT_STYLE.pointRadius,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** One style for every geometry of a free layer: the stroke for lines and outlines, the fill for areas, a dot for points. */
export function olStyleFor(style: PersonalLayerStyle): Style {
  return new Style({
    stroke: new Stroke({ color: style.color, width: style.width }),
    fill: new Fill({ color: hexToRgba(style.color, style.fillOpacity) }),
    image: new CircleStyle({
      radius: style.pointRadius,
      fill: new Fill({ color: style.color }),
      stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
    }),
  });
}

const CHANGED_COLOR = '#7048e8';

/** Drawn over an edit copy's feature that the draft changed: a dashed outline (a dashed ring on a point). */
export const CHANGED_OVERLAY = new Style({
  stroke: new Stroke({ color: CHANGED_COLOR, width: 3, lineDash: [6, 4] }),
  image: new CircleStyle({ radius: 11, stroke: new Stroke({ color: CHANGED_COLOR, width: 3, lineDash: [4, 3] }) }),
});

interface PropertyReader { get(key: string): unknown }

/**
 * An edit copy's rows carry the database column names (external_id, stream_order, status…),
 * while the official styles read the ISO names the WFS loader gives the official layers
 * (wfsSource.normalizeLoadedFeatures). The style reads through this view; the feature keeps its
 * own properties, which the feature card and the edit forms use. Cached per feature: a read
 * builds new features, so a cached view never outlives the properties it was made from.
 */
const isoViews = new WeakMap<FeatureLike, PropertyReader>();
function isoView(layerKey: EditableLayerKey, feature: FeatureLike): PropertyReader {
  let view = isoViews.get(feature);
  if (!view) {
    const iso = normalizeFeatureProperties(layerKey, feature.getProperties()) as unknown as Record<string, unknown>;
    if (layerKey === 'dams') iso.statusSlug = toDamStatusSlug(iso.operationalStatus);
    view = { get: (key) => iso[key] };
    isoViews.set(feature, view);
  }
  return view;
}

/**
 * An edit copy is drawn like the official layer it copies; a feature the draft changed gets
 * CHANGED_OVERLAY on top. The layer's own `style` is not used (its opacity is the layer's).
 */
export function editCopyStyle(layerKey: EditableLayerKey, isChanged: (externalId: string) => boolean): StyleFunction {
  const official = officialStyleFor(layerKey);
  return (feature, resolution) => {
    const base = typeof official === 'function'
      ? official(isoView(layerKey, feature) as unknown as FeatureLike, resolution)
      : official;
    const styles = base ? (Array.isArray(base) ? base : [base]) : [];
    const externalId = feature.get('external_id');
    if (externalId !== undefined && externalId !== null && isChanged(String(externalId))) return [...styles, CHANGED_OVERLAY];
    return styles.length > 0 ? styles : undefined;
  };
}

// --- The table's symbol cell -------------------------------------------------------------

const SYMBOL_SIZE: [number, number] = [20, 16];
/** Largest point radius and stroke width drawn in the cell; a bigger symbol is drawn at this size. */
const SYMBOL_MAX_RADIUS = 7;
const SYMBOL_MAX_WIDTH = 4;
/**
 * A resolution fine enough that every zoom-dependent official style draws (rivers leave out small
 * streams when zoomed out); the cell shows the feature's symbol, not the current zoom's.
 */
const SYMBOL_RESOLUTION = 1;

const SYMBOL_GEOMETRY: Record<GeometryType, () => Geometry> = {
  point: () => new Point([10, 8]),
  line: () => new LineString([[2, 12], [7, 5], [13, 11], [18, 4]]),
  polygon: () => new Polygon([[[2, 2], [18, 2], [18, 14], [2, 14], [2, 2]]]),
};

/** The official layer an edit copy copies, or null for any other layer. */
export function editCopyKey(layer: LayerSummary): EditableLayerKey | null {
  const key = layer.layerKey;
  return layer.kind === 'edit_copy' && (EDITABLE_LAYER_KEYS as readonly string[]).includes(key ?? '')
    ? (key as EditableLayerKey)
    : null;
}

/** A style shrunk to fit the cell: a big point or a wide stroke would fill or overflow it. */
function fitToCell(style: Style): Style {
  const image = style.getImage();
  const stroke = style.getStroke();
  const bigPoint = image instanceof CircleStyle && image.getRadius() > SYMBOL_MAX_RADIUS;
  const wide = (stroke?.getWidth() ?? 0) > SYMBOL_MAX_WIDTH;
  if (!bigPoint && !wide) return style;
  const fitted = style.clone();
  if (bigPoint) {
    const circle = (image as CircleStyle).clone();
    circle.setRadius(SYMBOL_MAX_RADIUS);
    fitted.setImage(circle);
  }
  if (wide) fitted.getStroke()!.setWidth(SYMBOL_MAX_WIDTH);
  return fitted;
}

/** The official styles an edit copy's feature with these properties is drawn with. */
function officialStylesOf(key: EditableLayerKey, properties: Record<string, unknown>): Style[] {
  const official = officialStyleFor(key);
  if (typeof official !== 'function') return official ? (Array.isArray(official) ? official : [official]) : [];
  // The same column-name → standard-name step the map's edit-copy style reads through.
  const iso = normalizeFeatureProperties(key, properties) as unknown as Record<string, unknown>;
  if (key === 'dams') iso.statusSlug = toDamStatusSlug(iso.operationalStatus);
  const reader = { get: (name: string) => iso[name] } as unknown as FeatureLike;
  const out = official(reader, SYMBOL_RESOLUTION);
  return out ? (Array.isArray(out) ? out : [out]) : [];
}

/** A number per style object; the official styles are shared objects (cached per class), so it names the symbol. */
const styleIds = new WeakMap<object, number>();
let nextStyleId = 0;
function styleId(style: object): number {
  let id = styleIds.get(style);
  if (id === undefined) {
    id = ++nextStyleId;
    styleIds.set(style, id);
  }
  return id;
}

const symbols = new Map<string, string>();

/**
 * The symbol of one feature, as the map draws it, for the table's first column: its style drawn
 * on a 20×16 canvas with ol/render's toContext, as a data URL. Cached per layer and style, so a
 * page of 100 rows draws only its distinct symbols. Empty when the browser cannot draw.
 */
export function symbolDataUrl(
  layer: LayerSummary, properties: Record<string, unknown>, geometryType: GeometryType,
): string {
  const key = editCopyKey(layer);
  // A free layer draws every feature alike; an edit copy's symbol depends on the feature.
  const official = key ? officialStylesOf(key, properties) : null;
  const styleKey = key
    ? `copy:${key}:${official!.map(styleId).join(',')}`
    : `free:${JSON.stringify(parseStyle(layer.style))}`;
  const cacheKey = `${layer.id}|${geometryType}|${styleKey}`;
  const cached = symbols.get(cacheKey);
  if (cached !== undefined) return cached;
  const styles = official ?? [olStyleFor(parseStyle(layer.style))];

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return '';
  // Drawn at the screen's pixel ratio (at most 2) so the symbol stays sharp; shown at 20×16.
  const pixelRatio = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const vectorContext = toContext(context, { size: SYMBOL_SIZE, pixelRatio });
  const geometry = SYMBOL_GEOMETRY[geometryType]();
  for (const style of styles) {
    vectorContext.setStyle(fitToCell(style));
    vectorContext.drawGeometry(geometry);
  }
  const url = canvas.toDataURL();
  symbols.set(cacheKey, url);
  return url;
}