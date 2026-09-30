import type { Map } from 'ol';
import Draw, { createBox } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type Geometry from 'ol/geom/Geometry';
import type { GeoJsonGeometry } from '@webatlas/shared';
import type { RoiDrawKind } from '../../roi/model/roi.store';
import { olGeometryTo4326GeoJSON } from './geo';
import { drawCondition } from './drawAids';

export interface RoiDrawHooks {
  /** Pixel distance within which a click on the first vertex closes the polygon (U-11). */
  snapTolerancePx?: number;
  /** Attach the drawing aids to the live interaction; returns their cleanup (Task 12). */
  onDrawCreated?: (draw: Draw) => () => void;
  /** Refuse a finished shape: a message, or null to accept it. */
  validate?: (g: Geometry) => string | null;
  onInvalid?: (message: string) => void;
}

/**
 * One ROI drawing (F1). Returns a cleanup that removes the interaction, its sketch layer
 * and the aids. A refused shape leaves the interaction running, so the user redraws.
 * The sketch keeps OpenLayers' default blue so it is never confused with the committed
 * ROI's dark dashed outline (U-7).
 */
export function startRoiDraw(
  map: Map, kind: RoiDrawKind, onDone: (g: GeoJsonGeometry) => void, hooks: RoiDrawHooks = {}
): () => void {
  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    zIndex: 996,
    style: { 'stroke-color': '#2563eb', 'stroke-width': 2, 'fill-color': 'rgba(37, 99, 235, 0.08)', 'circle-radius': 6, 'circle-fill-color': '#2563eb' },
  });
  const common = { condition: drawCondition, ...(hooks.snapTolerancePx !== undefined ? { snapTolerance: hooks.snapTolerancePx } : {}) };
  const draw = kind === 'Box'
    ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), ...common })
    : new Draw({ source, type: kind, ...common });

  draw.on('drawend', (e) => {
    const geometry = e.feature.getGeometry();
    if (!geometry) return;
    const problem = hooks.validate?.(geometry) ?? null;
    if (problem) {
      hooks.onInvalid?.(problem);
      // The refused feature is added to `source` after this event; drop it next tick.
      setTimeout(() => source.clear());
      return;
    }
    onDone(olGeometryTo4326GeoJSON(geometry) as unknown as GeoJsonGeometry);
  });

  map.addLayer(layer);
  map.addInteraction(draw);
  const detachAids = hooks.onDrawCreated?.(draw) ?? (() => {});
  return () => {
    detachAids();
    map.removeInteraction(draw);
    map.removeLayer(layer);
  };
}
