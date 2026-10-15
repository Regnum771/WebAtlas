import { describe, it, expect } from 'vitest';
import Map from 'ol/Map';
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
import View from 'ol/View';
import ImageStatic from 'ol/source/ImageStatic';
import { fromLonLat } from 'ol/proj';
import type { FloodPlanRow } from '@webatlas/shared';
import { FLOOD_LAYER_IDS, clearFloodLayers, roadStatusAt, syncFloodLayers } from './floodLayers';

function makeMap(): Map {
  return new Map({ target: document.createElement('div'), view: new View({ center: fromLonLat([108.2, 15.85]), zoom: 10 }) });
}
const layer = (map: Map, id: string) => map.getLayers().getArray().find((l) => l.get('id') === id) as
  (ReturnType<Map['getLayers']>['getArray'] extends () => (infer L)[] ? L : never) & { getSource(): unknown } | undefined;
const roads = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, geometry: { type: 'LineString', coordinates: [[108.2, 15.85], [108.21, 15.86]] }, properties: { cutHour: 10, name: 'ĐT609' } },
    { type: 'Feature' as const, geometry: { type: 'LineString', coordinates: [[108.3, 15.85], [108.31, 15.86]] }, properties: { cutHour: 50, name: null } },
  ],
};
const plan: FloodPlanRow[] = [{
  priority: 1, wardCode: '1', wardName: 'Xã Đại Lộc', deadlineHour: 7, deadlineTime: '04:00 28/10/2025', alreadyWet: false,
  peopleEst: 100, shelter: { id: 's', name: 'Trường A', kind: 'school', lonLat: [108.1, 15.86] }, distanceM: 1000, openRoads: [],
  arrow: { type: 'LineString', coordinates: [[108.12, 15.87], [108.1, 15.86]] },
}];
const base = { scenarioId: 'kttv-2025-10' as const, frameExtent: [0, 0, 1000, 1000] as [number, number, number, number], roads, plan: null, hour: 24 };

describe('floodLayers', () => {
  it('draws the frame for the current hour and swaps it when the hour changes', () => {
    const map = makeMap();
    syncFloodLayers(map, base);
    const frame = layer(map, FLOOD_LAYER_IDS.frame)!;
    const first = frame.getSource() as ImageStatic;
    expect(first.getUrl()).toContain('/api/scenarios/kttv-2025-10/frames/24');
    syncFloodLayers(map, { ...base, hour: 25 });
    expect((frame.getSource() as ImageStatic).getUrl()).toContain('/frames/25');
    syncFloodLayers(map, { ...base, hour: 25 });
    expect(map.getLayers().getArray().filter((l) => l.get('id') === FLOOD_LAYER_IDS.frame)).toHaveLength(1);
  });

  it('marks roads cut by the hour as cut and the rest as later', () => {
    expect(roadStatusAt(10, 24)).toBe('cut');
    expect(roadStatusAt(50, 24)).toBe('later');
    expect(roadStatusAt(24, 24)).toBe('cut');
  });

  it('draws the plan only when there is one, and clears everything', () => {
    const map = makeMap();
    syncFloodLayers(map, base);
    expect((layer(map, FLOOD_LAYER_IDS.plan) as unknown as { getSource(): { getFeatures(): unknown[] } }).getSource().getFeatures()).toHaveLength(0);
    syncFloodLayers(map, { ...base, plan });
    expect((layer(map, FLOOD_LAYER_IDS.plan) as unknown as { getSource(): { getFeatures(): unknown[] } }).getSource().getFeatures()).toHaveLength(2);
    clearFloodLayers(map);
    expect(Object.values(FLOOD_LAYER_IDS).map((id) => layer(map, id))).toEqual([undefined, undefined, undefined]);
  });
});
