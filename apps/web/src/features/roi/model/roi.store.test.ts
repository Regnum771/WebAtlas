import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ResolvedRoi, Roi } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import {
  clearRoi, dismissRoiMessage, getRoiState, resetRoiStore, setRadius, setRoi, setRoiHint,
  setRoiResolver, startDrawing, stopDrawing,
} from './roi.store';

const line: ResolvedRoi = {
  label: 'Sông Ba', kind: 'line', measure: { lengthKm: 352 },
  display: { type: 'LineString', coordinates: [[108, 13], [108.1, 13.1]] },
  bbox: [108, 13, 108.1, 13.1], centroid: [108.05, 13.05],
};
const buffered: ResolvedRoi = { ...line, label: 'Sông Ba + 5 km', kind: 'area', measure: { areaKm2: 2882 } };
const river: Roi = { source: 'feature', layerKey: 'rivers', featureId: 'r1', whole: true };

function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

beforeEach(() => resetRoiStore());

describe('roi.store', () => {
  it('starts empty', () => {
    expect(getRoiState()).toMatchObject({ roi: null, resolved: null, status: 'empty', error: null });
  });

  it('resolves a pick and keeps it with its fit mode', async () => {
    setRoiResolver(vi.fn().mockResolvedValue(line));
    const pending = setRoi(river, { fit: true });
    expect(getRoiState().status).toBe('resolving');
    await pending;
    expect(getRoiState()).toMatchObject({ roi: river, resolved: line, status: 'ready', fit: true });
  });

  it('keeps the previous ROI when a new pick fails, and shows the reason (FR-14)', async () => {
    setRoiResolver(vi.fn().mockResolvedValueOnce(line)
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'Vùng phân tích quá lớn')));
    await setRoi(river, { fit: true });
    await setRoi({ source: 'admin', level: 'province', code: '68' }, { fit: true });
    expect(getRoiState()).toMatchObject({ roi: river, resolved: line, status: 'ready', error: 'Vùng phân tích quá lớn' });
    dismissRoiMessage();
    expect(getRoiState().error).toBeNull();
  });

  it('ignores a slower, older pick that resolves after a newer one', async () => {
    const first = deferred<ResolvedRoi>(); const second = deferred<ResolvedRoi>();
    setRoiResolver(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const a = setRoi(river, { fit: true });
    const b = setRoi({ ...river, featureId: 'r2' }, { fit: true });
    second.resolve(buffered); await b;
    first.resolve(line); await a;
    expect(getRoiState().resolved).toBe(buffered);
  });

  it('adds and removes a radius through the resolver, refitting only if needed', async () => {
    const resolver = vi.fn().mockResolvedValueOnce(line).mockResolvedValueOnce(buffered).mockResolvedValueOnce(line);
    setRoiResolver(resolver);
    await setRoi(river, { fit: true });
    await setRadius(5);
    expect(resolver).toHaveBeenLastCalledWith({ ...river, radiusKm: 5 });
    expect(getRoiState()).toMatchObject({ resolved: buffered, fit: 'ifOutside' });
    await setRadius(null);
    expect(resolver).toHaveBeenLastCalledWith(river);
  });

  it('clears, and a clear wins over a pick still in flight', async () => {
    const pending = deferred<ResolvedRoi>();
    setRoiResolver(vi.fn().mockReturnValue(pending.promise));
    const p = setRoi(river, { fit: true });
    clearRoi();
    pending.resolve(line); await p;
    expect(getRoiState()).toMatchObject({ roi: null, resolved: null, status: 'empty' });
  });

  it('tracks drawing and returns to the settled state when it stops', async () => {
    setRoiResolver(vi.fn().mockResolvedValue(line));
    startDrawing('Polygon');
    expect(getRoiState()).toMatchObject({ status: 'drawing', drawKind: 'Polygon' });
    stopDrawing();
    expect(getRoiState()).toMatchObject({ status: 'empty', drawKind: null });
    await setRoi(river, { fit: false });
    startDrawing('Box'); stopDrawing();
    expect(getRoiState().status).toBe('ready');
  });

  it('holds a neutral hint separately from errors (U-2)', () => {
    setRoiHint('Cần một đường, ví dụ một con sông');
    expect(getRoiState()).toMatchObject({ hint: 'Cần một đường, ví dụ một con sông', error: null });
  });

  it('a drawing started while a pick resolves survives the pick', async () => {
    const pending = deferred<ResolvedRoi>();
    setRoiResolver(vi.fn().mockReturnValue(pending.promise));
    const p = setRoi(river, { fit: true });
    expect(getRoiState()).toMatchObject({ status: 'resolving' });
    startDrawing('Polygon');
    expect(getRoiState()).toMatchObject({ status: 'drawing', drawKind: 'Polygon' });
    pending.resolve(line); await p;
    expect(getRoiState()).toMatchObject({ status: 'drawing', drawKind: 'Polygon', resolved: line });
  });

  it('stopDrawing during a resolve leaves it resolving', async () => {
    const pending = deferred<ResolvedRoi>();
    setRoiResolver(vi.fn().mockReturnValue(pending.promise));
    const p = setRoi(river, { fit: true });
    expect(getRoiState()).toMatchObject({ status: 'resolving' });
    stopDrawing();
    expect(getRoiState()).toMatchObject({ status: 'resolving', drawKind: null });
    pending.resolve(line); await p;
    expect(getRoiState()).toMatchObject({ status: 'ready' });
  });
});
