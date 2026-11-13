import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resetTimeSlider, setSteps, setTime } from '../../time-slider/model/timeSlider.store';
import Map from 'ol/Map';
import View from 'ol/View';
import { addCatalogueLayer, getCatalogue, resetCatalogue, setCatalogueLayer } from './catalogue.store';
import { syncCatalogueLayers } from './catalogueLayers';
import { formatHoverValue, hoverText, useCatalogueHover } from './useCatalogueHover';
import type { CatalogueItem } from '../api/catalogue.api';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

describe('hover formatting', () => {
  it('writes depth with a decimal comma and two decimals', () => {
    expect(formatHoverValue(0.3049, 'm')).toBe('0,30 m');
    expect(formatHoverValue(12, null)).toBe('12');
  });
  it('builds "<value> <unit> · <date>" and drops nodata', () => {
    const d = new Date(2025, 9, 26, 7, 5);
    const fc = { features: [{ properties: { GRAY_INDEX: 0.3049 } }] };
    expect(hoverText(fc, 'm', d.toISOString())).toBe('0,30 m · 26/10/2025 07:05');
    expect(hoverText({ features: [] }, 'm', d.toISOString())).toBeNull();
    expect(hoverText({ features: [{ properties: { GRAY_INDEX: -9999 } }] }, 'm', d.toISOString())).toBeNull();
    expect(hoverText({ features: [{ properties: { GRAY_INDEX: 'NaN' } }] }, 'm', d.toISOString())).toBeNull();
    expect(hoverText({}, 'm', d.toISOString())).toBeNull();
  });
});

describe('useCatalogueHover', () => {
  const fetchMock = vi.fn();
  const item: CatalogueItem = {
    id: 't', kind: 'timeseries', title: 't', abstract: '', managingUnit: null, isPublished: true, mine: false,
    variable: 'depth', unit: 'm', timeSteps: ['2025-10-26T00:00:00Z'], bbox4326: null, layerName: 'geonode:t', updatedAt: '2026-11-12T00:00:00Z',
  };
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetCatalogue();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const move = (map: Map) => map.dispatchEvent({ type: 'pointermove', coordinate: [100, 100], pixel: [5, 5], dragging: false } as never);

  it('asks GetFeatureInfo through the proxy after the pointer rests 300 ms and shows the tooltip', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ features: [{ properties: { GRAY_INDEX: 0.3049 } }] }) });
    addCatalogueLayer(item);
    const map = new Map({ view: new View({ center: [0, 0], zoom: 5 }) });
    syncCatalogueLayers(map, getCatalogue(), '2025-10-26T05:00:00Z');
    renderHook(() => useCatalogueHover(map));
    move(map);
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/\/api\/catalogue\/t\/wms\?/);
    expect(url).toContain('GetFeatureInfo');
    expect(url).toContain('INFO_FORMAT=application%2Fjson');
    expect(url).toContain('TIME=2025-10-26T00%3A00%3A00Z');
    await vi.advanceTimersByTimeAsync(0);
    const tip = map.getOverlays().getArray()[0].getElement() as HTMLElement;
    expect(tip.textContent).toMatch(/^0,30 m · 26\/10\/2025/);
  });

  it('hides the tooltip when the slider time changes or the layer is toggled off', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ features: [{ properties: { GRAY_INDEX: 0.3 } }] }) });
    addCatalogueLayer(item);
    const map = new Map({ view: new View({ center: [0, 0], zoom: 5 }) });
    syncCatalogueLayers(map, getCatalogue(), '2025-10-26T05:00:00Z');
    renderHook(() => useCatalogueHover(map));
    const tip = () => map.getOverlays().getArray()[0].getElement() as HTMLElement;
    const show = async () => { move(map); await vi.advanceTimersByTimeAsync(300); await vi.advanceTimersByTimeAsync(0); };
    await show();
    expect(tip().hidden).toBe(false);
    act(() => setSteps(['2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z']));
    act(() => setTime('2025-10-26T01:00:00Z'));
    expect(tip().hidden).toBe(true);
    await show();
    expect(tip().hidden).toBe(false);
    act(() => setCatalogueLayer('t', { visible: false }));
    expect(tip().hidden).toBe(true);
    act(() => resetTimeSlider());
  });

  it('moving again before 300 ms restarts the wait; nodata shows nothing', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ features: [] }) });
    addCatalogueLayer(item);
    const map = new Map({ view: new View({ center: [0, 0], zoom: 5 }) });
    syncCatalogueLayers(map, getCatalogue(), '2025-10-26T05:00:00Z');
    renderHook(() => useCatalogueHover(map));
    move(map);
    await vi.advanceTimersByTimeAsync(200);
    move(map);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect((map.getOverlays().getArray()[0].getElement() as HTMLElement).hidden).toBe(true);
  });

  it('does nothing without a visible time-series layer', async () => {
    const map = new Map({ view: new View({ center: [0, 0], zoom: 5 }) });
    renderHook(() => useCatalogueHover(map));
    move(map);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
