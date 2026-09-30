import { describe, it, expect, vi } from 'vitest';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { fromLonLat } from 'ol/proj';
import {
  closeTolerancePx, formatLive, handleDrawKey, isSimplePolygon, nearFirstVertex, validateShape,
} from './drawAids';

const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const bowTie = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];

describe('isSimplePolygon', () => {
  it('accepts a square and a triangle', () => {
    expect(isSimplePolygon(sq)).toBe(true);
    expect(isSimplePolygon([[0, 0], [2, 0], [1, 1], [0, 0]])).toBe(true);
  });
  it('refuses a bow-tie', () => {
    expect(isSimplePolygon(bowTie)).toBe(false);
  });
});

describe('validateShape', () => {
  it('refuses a self-intersecting polygon with the spec’s message, and accepts lines', () => {
    expect(validateShape(new Polygon([bowTie]))).toBe('Vùng tự cắt nhau — hãy vẽ lại');
    expect(validateShape(new Polygon([sq]))).toBeNull();
    expect(validateShape(new LineString([[0, 0], [1, 1], [1, 0], [0, 1]]))).toBeNull();
  });
});

describe('snap-to-close', () => {
  it('is near within the tolerance, not beyond', () => {
    expect(nearFirstVertex([100, 100], [110, 105], 12)).toBe(true);
    expect(nearFirstVertex([100, 100], [120, 100], 12)).toBe(false);
  });
  it('is wider on touch input', () => {
    expect(closeTolerancePx(false)).toBe(12);
    expect(closeTolerancePx(true)).toBe(20);
  });
});

describe('handleDrawKey', () => {
  const draw = () => ({ removeLastPoint: vi.fn(), finishDrawing: vi.fn(), abortDrawing: vi.fn() });
  it('Backspace removes a vertex, or cancels when there is none', () => {
    const d = draw();
    expect(handleDrawKey('Backspace', d, 3)).toBe('undo');
    expect(d.removeLastPoint).toHaveBeenCalled();
    expect(handleDrawKey('Backspace', d, 0)).toBe('cancel');
    expect(d.abortDrawing).toHaveBeenCalled();
  });
  it('Enter finishes, Esc cancels, other keys do nothing', () => {
    const d = draw();
    expect(handleDrawKey('Enter', d, 3)).toBe('finish');
    expect(d.finishDrawing).toHaveBeenCalled();
    expect(handleDrawKey('Escape', d, 3)).toBe('cancel');
    expect(handleDrawKey('a', d, 3)).toBeNull();
  });
});

describe('formatLive', () => {
  it('measures a line in km and a polygon in km²', () => {
    const line = new LineString([fromLonLat([108.05, 12.68]), fromLonLat([108.25, 12.68])]);
    expect(formatLive(line)).toMatch(/^2[12] km$/);
    const poly = new Polygon([[fromLonLat([108, 12]), fromLonLat([108.1, 12]), fromLonLat([108.1, 12.1]), fromLonLat([108, 12.1]), fromLonLat([108, 12])]]);
    expect(formatLive(poly)).toMatch(/km²$/);
  });
});
