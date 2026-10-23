import type { FeatureLike } from 'ol/Feature';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import { normalizeFeatureProperties, toDamStatusSlug, type EditableLayerKey } from '@webatlas/shared';
import { officialStyleFor } from '../../map/model/styles';

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
