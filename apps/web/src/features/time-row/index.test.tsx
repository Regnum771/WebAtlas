import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FloodScenarioDetail } from '@webatlas/shared';
import TimeRow from '.';
import { layersModel, scenarioModel } from './model/timeRowModel';
import {
  getFloodState, openScenario, resetFloodStore, setFloodLoader, type FloodState,
} from '../flood-scenario/model/flood.store';
import { getTimeSlider, resetTimeSlider, setSteps, setStepsFor } from '../time-slider/model/timeSlider.store';

// The row's Radix slider measures its thumb; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
}

const detail = {
  id: 'kttv-2025-10', name: 'KTTV', kind: 'kttv', rainTotalMm: null, startTime: '2025-10-25T17:00:00Z', hours: 48,
  bulletinHour: 12, basis: '', floodplainOffsetM: 1.5, stations: [], series: {}, floodedKm2: [], frameExtent: [0, 0, 1, 1],
} as unknown as FloodScenarioDetail;
const STEPS = ['2025-10-26T00:00:00Z', '2025-10-26T06:00:00Z', '2025-10-27T00:00:00Z', '2025-10-28T00:00:00Z'];

async function openReady() {
  setFloodLoader({
    fetchScenarios: async () => [], fetchScenario: async () => detail,
    fetchRoads: async () => ({ type: 'FeatureCollection', features: [] }), fetchPlan: async () => [], preloadFrames: async () => {},
  });
  await act(async () => { await openScenario('kttv-2025-10'); });
}

beforeEach(() => { resetFloodStore(); resetTimeSlider(); });
afterEach(() => { vi.useRealTimers(); });

describe('time row models', () => {
  it('the scenario: hours, midnight ticks, the issue hour, its hours per tick', () => {
    const m = scenarioModel({ ...getFloodState(), scenarioId: 'kttv-2025-10', status: 'ready', detail, hour: 5, speed: 2 } as FloodState)!;
    expect(m).toMatchObject({ source: 'scenario', count: 49, index: 5, issueIndex: 12, stepSize: 2, stepUnit: 'giờ' });
    expect(m.ticks).toEqual([{ index: 0, label: '26/10' }, { index: 24, label: '27/10' }, { index: 48, label: '28/10' }]);
    expect(m.label(12)).toBe('12:00 26/10/2025');
  });

  it('no scenario model until it is ready', () => {
    expect(scenarioModel({ ...getFloodState(), scenarioId: 'kttv-2025-10', status: 'loading' } as FloodState)).toBeNull();
  });

  it('the layers: their steps, the step at or before the time, no issue mark', () => {
    setSteps(STEPS);
    const m = layersModel({ ...getTimeSlider(), time: '2025-10-26T09:00:00Z' })!;
    expect(m).toMatchObject({ source: 'layers', count: 4, index: 1, issueIndex: null, stepUnit: 'bước' });
    expect(layersModel({ ...getTimeSlider(), steps: [] })).toBeNull();
  });
});

describe('TimeRow', () => {
  it('renders nothing without a time source', () => {
    render(<TimeRow />);
    expect(screen.queryByRole('region', { name: 'Hàng thời gian' })).toBeNull();
  });

  it('follows the time layers, steps with the buttons, and × hides it until the layers change', async () => {
    const user = userEvent.setup();
    act(() => { setStepsFor('catalogue', STEPS); });
    render(<TimeRow />);
    expect(screen.getByRole('region', { name: 'Hàng thời gian' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Thời điểm' })).toHaveAttribute('aria-valuemax', '3');
    await user.click(screen.getByRole('button', { name: 'Tiến một bước' }));
    expect(getTimeSlider().time).toBe(STEPS[1]);
    await user.click(screen.getByRole('button', { name: 'Ẩn hàng thời gian' }));
    expect(screen.queryByRole('region', { name: 'Hàng thời gian' })).toBeNull();
    act(() => { setStepsFor('catalogue', STEPS.slice(0, 3)); });
    expect(screen.getByRole('region', { name: 'Hàng thời gian' })).toBeInTheDocument();
  });

  it('the open scenario drives it over the layers, with its issue time and × closing the scenario', async () => {
    const user = userEvent.setup();
    act(() => { setStepsFor('catalogue', STEPS); });
    await openReady();
    render(<TimeRow />);
    expect(screen.getByRole('slider', { name: 'Thời điểm' })).toHaveAttribute('aria-valuemax', '48');
    expect(screen.getByText('Phát hành lúc 12:00 26/10/2025; trước đó là thực đo, sau đó là dự báo.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bước mỗi giây' })).toHaveTextContent('1 giờ/giây');
    await user.click(screen.getByRole('button', { name: 'Tiến một bước' }));
    expect(getFloodState().hour).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Đóng kịch bản lũ' }));
    expect(getFloodState().scenarioId).toBeNull();
    // The layers take the row back.
    expect(screen.getByRole('slider', { name: 'Thời điểm' })).toHaveAttribute('aria-valuemax', '3');
  });

  it('plays and pauses the scenario', async () => {
    const user = userEvent.setup();
    await openReady();
    render(<TimeRow />);
    await user.click(screen.getByRole('button', { name: 'Phát' }));
    expect(getFloodState().playing).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(getFloodState().playing).toBe(false);
  });

  it('publishes its height on the map stage while it shows', () => {
    act(() => { setStepsFor('catalogue', STEPS); });
    const { container, unmount } = render(<div className="map-stage-map"><TimeRow /></div>);
    const stage = container.querySelector<HTMLElement>('.map-stage-map')!;
    expect(stage.style.getPropertyValue('--time-row-height')).toBe('var(--time-row-size)');
    unmount();
    expect(stage.style.getPropertyValue('--time-row-height')).toBe('');
  });
});
