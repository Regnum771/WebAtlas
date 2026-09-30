import type { Map, MapBrowserEvent } from 'ol';
import { altKeyOnly, noModifierKeys } from 'ol/events/condition';
import type Draw from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { getArea, getLength } from 'ol/sphere';
import { Circle, Fill, Stroke, Style } from 'ol/style';
import { formatMeasure } from '../../roi/model/format';

type XY = number[];

function cross(o: XY, a: XY, b: XY): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segmentsCross(p1: XY, p2: XY, q1: XY, q2: XY): boolean {
  const d1 = cross(q1, q2, p1); const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1); const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two non-adjacent edges of the closed ring cross. */
export function isSimplePolygon(ring: XY[]): boolean {
  const n = ring.length - 1; // the ring repeats its first vertex at the end
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edge share a vertex
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  }
  return true;
}

/** U-11: a self-intersecting polygon is refused before any request. */
export function validateShape(g: Geometry): string | null {
  if (g instanceof Polygon && !isSimplePolygon(g.getCoordinates()[0])) return 'Vùng tự cắt nhau — hãy vẽ lại';
  return null;
}

export function nearFirstVertex(pointer: XY, first: XY, tolerancePx: number): boolean {
  return Math.hypot(pointer[0] - first[0], pointer[1] - first[1]) <= tolerancePx;
}

/** OpenLayers' own close distance is 12 px; a finger needs more (U-11). */
export function closeTolerancePx(coarsePointer: boolean): number {
  return coarsePointer ? 20 : 12;
}

/** Typing fields and focused controls keep their own keys (Enter presses a button). */
export function keyBelongsToTarget(t: EventTarget | null, key: string): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  // Esc still cancels while a draw tool button holds focus (the user just clicked it).
  return key !== 'Escape' && key !== 'Alt' && (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.tagName === 'A');
}

/**
 * Draw's own default (`noModifierKeys`) rejects any event with altKey, so holding Alt to
 * unsnap would also stop clicks placing vertices. Alt alone is allowed; Shift stays the
 * freehand key and Alt+Shift stays with DragRotate.
 */
export const drawCondition = (e: MapBrowserEvent): boolean => noModifierKeys(e) || altKeyOnly(e);

export type DrawKeyAction = 'undo' | 'finish' | 'cancel' | null;
type DrawLike = Pick<Draw, 'removeLastPoint' | 'finishDrawing' | 'abortDrawing'>;

/** Backspace removes the last vertex (or cancels when none is left); Enter finishes; Esc cancels. */
export function handleDrawKey(key: string, draw: DrawLike, vertexCount: number, minToFinish = 1): DrawKeyAction {
  if (key === 'Backspace') {
    if (vertexCount > 0) { draw.removeLastPoint(); return 'undo'; }
    draw.abortDrawing();
    return 'cancel';
  }
  if (key === 'Enter') {
    if (vertexCount < minToFinish) return null; // too few vertices to be a shape
    draw.finishDrawing();
    return 'finish';
  }
  if (key === 'Escape') { draw.abortDrawing(); return 'cancel'; }
  return null;
}

/** The shape's length or area, in the chip's formatting. Geometry is EPSG:3857. */
export function formatLive(g: Geometry): string | null {
  if (g instanceof Polygon) return formatMeasure({ areaKm2: getArea(g) / 1e6 });
  if (g instanceof LineString) return formatMeasure({ lengthKm: getLength(g) / 1000 });
  return null;
}

/** Transient layers are not snap targets: the ROI outline and the data layers are. */
export const NOT_SNAPPABLE = new Set([
  'layer_rivers_overview', 'layer_assistant_highlight', 'layer_analysis_results',
  // Whole-country admin boundaries: 58k-323k vertices, and not what a user snaps to.
  'layer_provinces_2026', 'layer_wards_2026',
]);

export function snapSourcesOf(map: Map): VectorSource[] {
  return map.getLayers().getArray()
    .filter((l): l is VectorLayer<VectorSource> => l instanceof VectorLayer && l.getVisible())
    .filter((l) => {
      const id = l.get('id') as string | undefined;
      return !!id && id.startsWith('layer_') && !NOT_SNAPPABLE.has(id);
    })
    .map((l) => l.getSource())
    .filter((s): s is VectorSource => s !== null);
}

const FIRST_VERTEX_STYLE = new Style({
  image: new Circle({ radius: 9, fill: new Fill({ color: 'rgba(37, 99, 235, 0.35)' }), stroke: new Stroke({ color: '#1d4ed8', width: 2 }) }),
});

export interface DrawAidsCallbacks {
  onHint: (hint: string | null) => void;
  onMeasure: (measure: string | null) => void;
  onCancel: () => void;
}

/**
 * U-11 on a live Draw interaction: snapping (Alt draws freely), a visible snap-to-close
 * cue, a live measure, and keyboard control. Returns a cleanup that undoes all of it.
 */
export function attachDrawAids(map: Map, draw: Draw, cb: DrawAidsCallbacks): () => void {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  const tolerance = closeTolerancePx(coarse);

  // Snapping — one Snap per source; removed while Alt is held.
  const snaps = snapSourcesOf(map).map((source) => new Snap({ source, pixelTolerance: 10 }));
  let snapping = false;
  const setSnapping = (on: boolean) => {
    if (on === snapping) return;
    snapping = on;
    for (const s of snaps) (on ? map.addInteraction(s) : map.removeInteraction(s));
  };
  setSnapping(true);

  // The first-vertex cue lives on its own tiny layer above the sketch.
  const cueSource = new VectorSource();
  const cueLayer = new VectorLayer({ source: cueSource, style: FIRST_VERTEX_STYLE, zIndex: 1000 });
  map.addLayer(cueLayer);

  let sketch: Geometry | null = null;
  let vertexCount = 0;
  const onSketchChange = () => {
    if (!sketch) return;
    cb.onMeasure(formatLive(sketch));
    if (sketch instanceof Polygon) vertexCount = Math.max(0, sketch.getCoordinates()[0].length - 2);
    else if (sketch instanceof LineString) vertexCount = Math.max(0, sketch.getCoordinates().length - 1);
  };
  draw.on('drawstart', (e) => {
    sketch = e.feature.getGeometry() ?? null;
    sketch?.on('change', onSketchChange);
  });
  draw.on(['drawend', 'drawabort'], () => {
    sketch = null; vertexCount = 0; cueSource.clear(); cb.onHint(null); cb.onMeasure(null);
  });

  const onPointerMove = (e: MapBrowserEvent) => {
    cueSource.clear();
    if (!(sketch instanceof Polygon) || vertexCount < 3) return;
    const first = sketch.getCoordinates()[0][0];
    const firstPx = map.getPixelFromCoordinate(first);
    if (firstPx && nearFirstVertex(e.pixel, firstPx, tolerance)) {
      cueSource.addFeature(new Feature(new Point(first)));
      cb.onHint('Nhấp để khép vùng');
    } else {
      cb.onHint(null);
    }
  };
  map.on('pointermove', onPointerMove);

  const onKeyDown = (e: KeyboardEvent) => {
    if (keyBelongsToTarget(e.target, e.key)) return;
    if (e.key === 'Alt') { setSnapping(false); return; }
    const action = handleDrawKey(e.key, draw, vertexCount, sketch instanceof Polygon ? 3 : sketch instanceof LineString ? 2 : 1);
    if (action === 'cancel') cb.onCancel();
    if (action && e.key === 'Backspace') e.preventDefault(); // not "browser back"
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setSnapping(true); };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    map.un('pointermove', onPointerMove);
    sketch?.un('change', onSketchChange);
    setSnapping(false);
    map.removeLayer(cueLayer);
  };
}
