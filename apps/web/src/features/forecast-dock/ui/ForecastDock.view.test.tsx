import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FloodScenarioDetail, FloodScenarioSummary } from '@webatlas/shared';
import { ForecastDockView, type ForecastDockViewProps } from './ForecastDock.view';

const summary: FloodScenarioSummary = {
  id: 'kttv-2025-10', name: 'Bản tin KTTV 21:00 28/10/2025', kind: 'kttv', rainTotalMm: null,
  startTime: '2025-10-25T17:00:00Z', hours: 48, bulletinHour: 12, basis: 'Tái hiện lũ 10/2025', floodplainOffsetM: 1.5,
};
const level = Array.from({ length: 49 }, (_, h) => 1 + h / 12);
const detail: FloodScenarioDetail = {
  ...summary,
  stations: [
    { id: 'cau-lau', name: 'Câu Lâu', river: 'Thu Bồn', bd1: 2, bd2: 3, bd3: 4, recordM: 5.62, recordYear: 2025, derived: false },
    { id: 'ai-nghia', name: 'Ái Nghĩa', river: 'Vu Gia', bd1: 8, bd2: 9, bd3: 10, recordM: null, recordYear: null, derived: false },
  ],
  series: {
    'cau-lau': { level, forecast: level.map((_, h) => (h === 24 ? 4.2 : null)) },
    'ai-nghia': { level: level.map(() => 5), forecast: level.map(() => null) },
  },
  floodedKm2: level.map((_, h) => h * 2),
  frameExtent: [0, 0, 1, 1],
};

function props(over: Partial<ForecastDockViewProps> = {}): ForecastDockViewProps {
  return {
    tab: 'overview', onTab: vi.fn(), scenarios: [summary], scenarioId: 'kttv-2025-10', status: 'ready', loaded: 49,
    error: null, detail, hour: 30, stationId: 'cau-lau', onStation: vi.fn(), onScenario: vi.fn(), onCloseScenario: vi.fn(),
    onRetry: vi.fn(), planShown: false, onTogglePlan: vi.fn(),
    kpis: [{ label: 'Mực nước Câu Lâu', value: 3.5, unit: 'm', note: 'trên BĐ2 (3,00 m)', tone: 'alert' }],
    rainTotalMm: null, rainDays: [], analysis: null, onExport: vi.fn(), ...over,
  };
}

describe('ForecastDockView', () => {
  it('heads the run with its issue time, model, horizon, basis and the MẪU tag', () => {
    render(<ForecastDockView {...props()} />);
    const head = document.querySelector('[data-slot="run-header"]') as HTMLElement;
    expect(head).toHaveTextContent('Phát hành 12:00 26/10/2025');
    expect(head).toHaveTextContent('Tầm dự báo 36 giờ');
    expect(head).toHaveTextContent('Tái hiện lũ 10/2025');
    expect(within(head).getByText('MẪU')).toBeInTheDocument();
    expect(within(head).getByRole('combobox', { name: 'Kịch bản lũ' })).toHaveTextContent('Bản tin KTTV 21:00 28/10/2025');
  });

  it('offers the four tabs in order, and Xuất CSV', async () => {
    const p = props();
    render(<ForecastDockView {...p} />);
    expect(within(screen.getByRole('tablist', { name: 'Nội dung khung' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tổng quan', 'Mưa', 'Mực nước', 'Phân tích']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xuất CSV' }));
    expect(p.onExport).toHaveBeenCalled();
  });

  it('disables Xuất CSV when the tab has nothing to export', () => {
    render(<ForecastDockView {...props({ onExport: null })} />);
    expect(screen.getByRole('button', { name: 'Xuất CSV' })).toBeDisabled();
  });

  it('shows the KPI row with units, threshold and time, the level chart and the forecast-point table', () => {
    render(<ForecastDockView {...props()} />);
    const kpis = screen.getByRole('region', { name: 'Chỉ số lúc 06:00 27/10/2025' });
    expect(within(kpis).getByText('3,5 m')).toBeInTheDocument();
    expect(within(kpis).getByText('trên BĐ2 (3,00 m)')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Mực nước tại Câu Lâu' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Điểm dự báo' });
    const [, cauLau, aiNghia] = within(table).getAllByRole('row');
    expect(cauLau).toHaveAttribute('data-tone', 'alert');
    expect(cauLau).toHaveTextContent('BĐ3');
    expect(aiNghia).not.toHaveAttribute('data-tone');
    expect(aiNghia).toHaveTextContent('dưới BĐ1');
    expect(screen.getByText(/^Nguồn: Mực nước:/)).toBeInTheDocument();
  });

  it('Mực nước charts every forecast point', () => {
    render(<ForecastDockView {...props({ tab: 'levels' })} />);
    expect(screen.getByRole('figure', { name: 'Mực nước tại Câu Lâu' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Mực nước tại Ái Nghĩa' })).toBeInTheDocument();
  });

  it('Mưa gives the rain total, or says the bulletin has none, and waits for the basin series', () => {
    render(<ForecastDockView {...props({ tab: 'rain' })} />);
    expect(screen.getByText('bản tin KTTV không kèm tổng mưa')).toBeInTheDocument();
    expect(screen.getByText('Chưa có chuỗi mưa lưu vực — có khi chạy mô phỏng mưa (S3).')).toBeInTheDocument();
  });

  it('Mưa draws the basin chart once there are days', () => {
    render(<ForecastDockView {...props({ tab: 'rain', rainTotalMm: 520, rainDays: [{ date: '2025-10-26', mm: 100 }, { date: '2025-10-27', mm: 300 }] })} />);
    expect(screen.getByText('520 mm')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Mưa lưu vực theo ngày' })).toBeInTheDocument();
  });

  it('Phân tích shows the analysis result, or how to get one', () => {
    const { rerender } = render(<ForecastDockView {...props({ tab: 'analysis' })} />);
    expect(screen.getByText(/Chưa có kết quả phân tích/)).toBeInTheDocument();
    rerender(<ForecastDockView {...props({ tab: 'analysis', analysis: <p>KẾT QUẢ</p> })} />);
    expect(screen.getByText('KẾT QUẢ')).toBeInTheDocument();
  });

  it('without a scenario, offers the picker and says how to open one', () => {
    render(<ForecastDockView {...props({ scenarioId: null, status: 'idle', detail: null })} />);
    expect(screen.getByRole('combobox', { name: 'Kịch bản lũ' })).toHaveTextContent('Chọn kịch bản lũ');
    expect(screen.getByText(/Chưa mở kịch bản lũ/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đóng kịch bản' })).toBeNull();
  });

  it('reports loading progress and a failed load with a retry', async () => {
    const { rerender } = render(<ForecastDockView {...props({ status: 'loading', detail: null, loaded: 10 })} />);
    expect(screen.getByText('Đang tải khung ngập 10/49')).toBeInTheDocument();
    const p = props({ status: 'error', detail: null });
    rerender(<ForecastDockView {...p} />);
    await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('button', { name: 'Thử lại' }));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('toggles the evacuation plan and closes the scenario from the run header', async () => {
    const user = userEvent.setup();
    const p = props({ planShown: true });
    render(<ForecastDockView {...p} />);
    expect(screen.getByRole('button', { name: 'Phương án sơ tán' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Phương án sơ tán' }));
    await user.click(screen.getByRole('button', { name: 'Đóng kịch bản' }));
    expect(p.onTogglePlan).toHaveBeenCalled();
    expect(p.onCloseScenario).toHaveBeenCalled();
  });
});
