import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatScenarioTime, type FloodScenarioDetail, type FloodScenarioSummary } from '@webatlas/shared';
import { FloodDockView, type FloodDockViewProps } from './FloodDock.view';

const summary: FloodScenarioSummary = {
  id: 'kttv-2025-10', name: 'Bản tin KTTV 21:00 28/10/2025 — tái hiện lũ 10/2025', kind: 'kttv', rainTotalMm: null,
  startTime: '2025-10-27T14:00:00.000Z', hours: 96, bulletinHour: 24, basis: 'Mực nước thực đo KTTV',
};
const detail: FloodScenarioDetail = {
  ...summary,
  stations: [{ id: 'cau-lau', name: 'Câu Lâu', river: 'Thu Bồn', bd1: 2, bd2: 3, bd3: 4, recordM: 5.62, recordYear: 2025, derived: false }],
  series: { 'cau-lau': { level: Array.from({ length: 97 }, () => 5), forecast: Array.from({ length: 97 }, () => null) } },
  floodedKm2: Array.from({ length: 97 }, () => 100),
  frameExtent: [0, 0, 1, 1],
};

function props(overrides: Partial<FloodDockViewProps> = {}): FloodDockViewProps {
  return {
    scenarios: [summary], scenarioId: 'kttv-2025-10', detail, hour: 30, playing: false, speed: 1, status: 'ready',
    loaded: 97, error: null, stationId: 'cau-lau',
    onScenario: vi.fn(), onHour: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onSpeed: vi.fn(), onStation: vi.fn(),
    onRetry: vi.fn(), onClose: vi.fn(),
    ...overrides,
  };
}

describe('FloodDockView', () => {
  it('labels the slider with the clock time of the hour', () => {
    render(<FloodDockView {...props()} />);
    expect(screen.getByRole('slider', { name: 'Thời điểm' })).toHaveAttribute('aria-valuetext', formatScenarioTime(summary.startTime, 30));
    expect(screen.getByText('Mực nước thực đo KTTV', { exact: false })).toBeInTheDocument();
  });

  it('shows a retry and disables the slider when the scenario failed to load', async () => {
    const p = props({ status: 'error', error: 'Không tải được kịch bản lũ.' });
    render(<FloodDockView {...p} />);
    expect(screen.getByText('Không tải được kịch bản lũ.')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Thời điểm' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('shows preload progress while loading', () => {
    render(<FloodDockView {...props({ status: 'loading', loaded: 37 })} />);
    expect(screen.getByText('Đang tải khung ngập 37/97')).toBeInTheDocument();
  });

  it('says there is no scenario data when the list is empty', () => {
    render(<FloodDockView {...props({ scenarios: [], scenarioId: null, detail: null, status: 'idle' })} />);
    expect(screen.getByText('Chưa có dữ liệu kịch bản')).toBeInTheDocument();
  });

  it('plays and pauses', async () => {
    const p = props();
    const { rerender } = render(<FloodDockView {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Phát' }));
    expect(p.onPlay).toHaveBeenCalled();
    rerender(<FloodDockView {...p} playing />);
    await userEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(p.onPause).toHaveBeenCalled();
  });
});
