import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import Feature from 'ol/Feature';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Draw, { DrawEvent } from 'ol/interaction/Draw';
import OlMap from 'ol/Map';
import { fromLonLat } from 'ol/proj';

// jsdom does not implement ResizeObserver, but ol/Map's constructor requires it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const h = vi.hoisted(() => ({ ctx: { map: null as unknown } }));
vi.mock('../../../app/providers/MapProvider', () => ({ useMapContext: () => h.ctx }));

import { useMeasure } from './useMeasure';
import { resetDrawing } from './drawingState';

function setup() {
  resetDrawing();
  const map = new OlMap({});
  h.ctx.map = map;
  const hook = renderHook(() => useMeasure());
  act(() => hook.result.current.start('length'));
  const draw = map.getInteractions().getArray().find((i): i is Draw => i instanceof Draw)!;
  return { map, hook, draw };
}

describe('useMeasure final reading', () => {
  it('keeps the final length after the drawing ends', () => {
    const { hook, draw } = setup();
    const line = new LineString([fromLonLat([108.05, 12.68]), fromLonLat([108.25, 12.68])]);
    const f = new Feature(line);
    act(() => { draw.dispatchEvent(new DrawEvent('drawstart', f)); });
    act(() => { draw.dispatchEvent(new DrawEvent('drawend', f)); });
    expect(hook.result.current.value).toMatch(/^Chiều dài: /);
  });

  it('shows the refusal for a self-intersecting polygon', () => {
    const { hook, map } = setup();
    act(() => hook.result.current.start('area'));
    const draw2 = map.getInteractions().getArray().find((i): i is Draw => i instanceof Draw)!;
    const bow = new Polygon([[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]].map(([x, y]) => [x * 1000, y * 1000])]);
    const f = new Feature(bow);
    act(() => { draw2.dispatchEvent(new DrawEvent('drawend', f)); });
    expect(hook.result.current.value).toBe('Vùng tự cắt nhau — hãy vẽ lại');
  });
});
