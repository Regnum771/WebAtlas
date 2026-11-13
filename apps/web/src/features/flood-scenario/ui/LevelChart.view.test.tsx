import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FloodScenarioDetail, FloodStation } from '@webatlas/shared';
import { LevelChartView } from './LevelChart.view';
import { midnightHours } from '../model/scenarioTime';
import { alarmReached, forecastPointRows } from '../model/levels';

const station: FloodStation = {
  id: 'cau-lau', name: 'Câu Lâu', river: 'Thu Bồn', bd1: 2, bd2: 3, bd3: 4, recordM: 5.62, recordYear: 2025, derived: false,
};
// 00:00 26/10 Vietnam time.
const START = '2025-10-25T17:00:00Z';
const level = Array.from({ length: 49 }, (_, h) => 1 + h / 12);
const forecast = level.map((_, h) => (h === 24 ? 3.5 : h === 36 ? 4.6 : null));

function renderChart(hour = 30) {
  return render(
    <LevelChartView station={station} level={level} forecast={forecast} hour={hour} bulletinHour={12}
      startTime={START} source="KTTV, bản tin lũ" sample />,
  );
}

describe('LevelChartView', () => {
  it('is a named figure with a summary, the MẪU tag and its source', () => {
    renderChart();
    const fig = screen.getByRole('figure', { name: 'Mực nước tại Câu Lâu' });
    expect(within(fig).getByText(/cao nhất 5,00 m, BĐ3/)).toBeInTheDocument();
    expect(within(fig).getByText('MẪU')).toBeInTheDocument();
    expect(within(fig).getByText('Nguồn: KTTV, bản tin lũ')).toBeInTheDocument();
  });

  it('names every series and alarm level in its legend', () => {
    renderChart();
    const legend = screen.getByRole('list', { name: 'Chú giải' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['Mực nước', 'Dự báo trong bản tin', 'BĐ1', 'BĐ2', 'BĐ3']);
  });

  it('draws BĐ1–BĐ3 with text labels, the record, the issue time and the current hour', () => {
    const { container } = renderChart();
    const labels = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    // 'm' is the y axis's unit label.
    for (const l of ['BĐ1', 'BĐ2', 'BĐ3', 'LS 2025', 'Phát hành', 'Hiện tại', 'm']) expect(labels).toContain(l);
    expect(container.querySelector('.recharts-yAxis-tick-labels')?.textContent).toMatch(/\d/);
    expect(container.querySelector('.recharts-xAxis-tick-labels')).toHaveTextContent('26/10');
  });

  it('has a table view listing every hour, the current one marked', async () => {
    renderChart(30);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Bảng' }));
    const table = screen.getByRole('table', { name: 'Mực nước tại Câu Lâu' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + 49);
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent))
      .toEqual(['Thời điểm', 'Mực nước (m)', 'Dự báo (m)', 'Cấp báo động']);
    expect(rows[1 + 24]).toHaveTextContent('00:00 27/10/2025');
    expect(rows[1 + 24]).toHaveTextContent('3,50');
    expect(rows[1 + 30]).toHaveAttribute('data-tone', 'current');
  });

  it('ticks each midnight, Vietnam time', () => {
    expect(midnightHours(START, 48)).toEqual([0, 24, 48]);
  });
});

describe('levels', () => {
  it('names the highest alarm level reached', () => {
    expect(alarmReached(station, 1.9)).toBeNull();
    expect(alarmReached(station, 2)).toBe('BĐ1');
    expect(alarmReached(station, 3.99)).toBe('BĐ2');
    expect(alarmReached(station, 4)).toBe('BĐ3');
  });

  it('gives one forecast-point row per station: bulletin level, forecast peak and its hour, alarm', () => {
    const detail = {
      stations: [station, { ...station, id: 'hoi-an', name: 'Hội An', derived: true }],
      series: { 'cau-lau': { level, forecast }, 'hoi-an': { level: level.map(() => 1), forecast: level.map(() => null) } },
      bulletinHour: 12,
    } as unknown as FloodScenarioDetail;
    const [cauLau, hoiAn] = forecastPointRows(detail);
    expect(cauLau).toMatchObject({ bulletinLevel: 2, forecastPeak: 4.6, forecastPeakHour: 36, alarm: 'BĐ3' });
    expect(hoiAn).toMatchObject({ forecastPeak: null, forecastPeakHour: null, alarm: null });
  });
});
