import type { Map } from 'ol';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import { LineString, Point } from 'ol/geom';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Circle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import type { FloodPlanRow, FloodScenarioId } from '@webatlas/shared';
import { frameUrl, type FloodRoadsCollection } from '../api/flood.api';

/** Not LAYER_STATE_IDs: the flood scenario is drawn by its dock, not toggled in the layer tree. */
export const FLOOD_LAYER_IDS = { frame: 'flood_frame', roads: 'flood_roads', plan: 'flood_plan' } as const;

export const FLOOD_COLORS = { cut: '#d7301f', later: '#fd8d3c', ink: '#18213A' } as const;

export interface FloodLayerInput {
  scenarioId: FloodScenarioId;
  frameExtent: [number, number, number, number];
  roads: FloodRoadsCollection | null;
  plan: FloodPlanRow[] | null;
  hour: number;
}

export function roadStatusAt(cutHour: number, hour: number): 'cut' | 'later' {
  return cutHour <= hour ? 'cut' : 'later';
}

interface FloodLayers {
  frame: ImageLayer<ImageStatic>;
  roads: VectorLayer<VectorSource>;
  plan: VectorLayer<VectorSource>;
  /** What is drawn now, so a repeat sync with the same inputs does no work. */
  key: { frameUrl: string | null; roads: FloodRoadsCollection | null; plan: FloodPlanRow[] | null; hour: number };
}

const layers = new WeakMap<Map, FloodLayers>();
const format = new GeoJSON();

const cutStyle = new Style({ stroke: new Stroke({ color: FLOOD_COLORS.cut, width: 3 }) });
const laterStyle = new Style({ stroke: new Stroke({ color: FLOOD_COLORS.later, width: 2 }) });

function planStyle(feature: FeatureLike): Style | Style[] {
  const geom = feature.getGeometry();
  if (geom instanceof Point) {
    return new Style({
      image: new Circle({ radius: 11, fill: new Fill({ color: '#ffffff' }), stroke: new Stroke({ color: FLOOD_COLORS.ink, width: 2 }) }),
      text: new Text({
        text: String(feature.get('label') ?? ''), font: '700 11px Archivo, sans-serif',
        fill: new Fill({ color: FLOOD_COLORS.ink }), overflow: true,
      }),
    });
  }
  const line = geom as LineString;
  const [x1, y1] = line.getFirstCoordinate();
  const [x2, y2] = line.getLastCoordinate();
  return [
    new Style({ stroke: new Stroke({ color: FLOOD_COLORS.ink, width: 2, lineDash: [8, 5] }) }),
    new Style({
      geometry: new Point([x2, y2]),
      image: new RegularShape({
        points: 3, radius: 7, fill: new Fill({ color: FLOOD_COLORS.ink }),
        rotation: Math.PI / 2 - Math.atan2(y2 - y1, x2 - x1), rotateWithView: true,
      }),
    }),
  ];
}

function ensure(map: Map): FloodLayers {
  const existing = layers.get(map);
  if (existing) return existing;
  const frame = new ImageLayer<ImageStatic>({ properties: { id: FLOOD_LAYER_IDS.frame }, zIndex: 990 });
  const roads = new VectorLayer({
    source: new VectorSource(),
    properties: { id: FLOOD_LAYER_IDS.roads },
    zIndex: 991,
    style: (f) => (roadStatusAt(f.get('cutHour') as number, roads.get('hour') as number) === 'cut' ? cutStyle : laterStyle),
  });
  const plan = new VectorLayer({ source: new VectorSource(), properties: { id: FLOOD_LAYER_IDS.plan }, zIndex: 994, style: planStyle });
  for (const l of [frame, roads, plan]) map.addLayer(l);
  const created: FloodLayers = { frame, roads, plan, key: { frameUrl: null, roads: null, plan: null, hour: -1 } };
  layers.set(map, created);
  return created;
}

function planFeatures(plan: FloodPlanRow[]): Feature[] {
  const out: Feature[] = [];
  const shelters = new globalThis.Map<string, { lonLat: [number, number]; priorities: number[] }>();
  for (const row of plan) {
    out.push(new Feature({ geometry: format.readGeometry(row.arrow, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }) }));
    const s = shelters.get(row.shelter.id) ?? { lonLat: row.shelter.lonLat, priorities: [] };
    s.priorities.push(row.priority);
    shelters.set(row.shelter.id, s);
  }
  for (const s of shelters.values()) {
    out.push(new Feature({ geometry: new Point(fromLonLat(s.lonLat)), label: s.priorities.join(',') }));
  }
  return out;
}

/** Draws the scenario at `hour`: the depth raster frame, roads coloured by whether they are cut yet, and the plan. */
export function syncFloodLayers(map: Map, input: FloodLayerInput): void {
  const l = ensure(map);
  const url = frameUrl(input.scenarioId, input.hour);
  if (l.key.frameUrl !== url) {
    // Frames are preloaded, so a new source draws from the browser cache without a visible gap.
    l.frame.setSource(new ImageStatic({ url, imageExtent: input.frameExtent, projection: 'EPSG:3857', crossOrigin: 'anonymous' }));
  }
  if (l.key.roads !== input.roads) {
    const src = l.roads.getSource()!;
    src.clear();
    if (input.roads) {
      src.addFeatures(format.readFeatures(input.roads, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }));
    }
  }
  if (l.key.hour !== input.hour) {
    l.roads.set('hour', input.hour);
    l.roads.changed();
  }
  if (l.key.plan !== input.plan) {
    const src = l.plan.getSource()!;
    src.clear();
    if (input.plan) src.addFeatures(planFeatures(input.plan));
  }
  l.key = { frameUrl: url, roads: input.roads, plan: input.plan, hour: input.hour };
}

export function clearFloodLayers(map: Map): void {
  const l = layers.get(map);
  if (!l) return;
  for (const layer of [l.frame, l.roads, l.plan]) map.removeLayer(layer);
  layers.delete(map);
}
