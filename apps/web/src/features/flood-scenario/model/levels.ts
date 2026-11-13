import type { FloodScenarioDetail, FloodStation } from '@webatlas/shared';

/** "9,12 m" (or "9,12" without the unit), two decimals as the bulletins give them. */
export function formatLevel(m: number, withUnit = true): string {
  const text = m.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withUnit ? `${text} m` : text;
}

/** The highest alarm level a water level reaches, or null below BĐ1. */
export function alarmReached(station: FloodStation, m: number): 'BĐ1' | 'BĐ2' | 'BĐ3' | null {
  if (m >= station.bd3) return 'BĐ3';
  if (m >= station.bd2) return 'BĐ2';
  if (m >= station.bd1) return 'BĐ1';
  return null;
}

export interface ForecastPointRow {
  station: FloodStation;
  /** The level at the bulletin's issue hour. */
  bulletinLevel: number;
  /** The highest of the bulletin's forecast points; null when the bulletin gave none for this point. */
  forecastPeak: number | null;
  forecastPeakHour: number | null;
  /** The highest alarm level the forecast peak (or, without one, the level series) reaches. */
  alarm: 'BĐ1' | 'BĐ2' | 'BĐ3' | null;
}

/** One row per forecast point (spec "forecast-point table"), in the scenario's station order. */
export function forecastPointRows(detail: FloodScenarioDetail): ForecastPointRow[] {
  return detail.stations.flatMap((station) => {
    const series = detail.series[station.id];
    if (!series) return [];
    let peak: number | null = null;
    let peakHour: number | null = null;
    series.forecast.forEach((v, h) => {
      if (v !== null && (peak === null || v > peak)) { peak = v; peakHour = h; }
    });
    const bulletinLevel = series.level[Math.min(detail.bulletinHour, series.level.length - 1)];
    const reference = peak ?? Math.max(...series.level);
    return [{ station, bulletinLevel, forecastPeak: peak, forecastPeakHour: peakHour, alarm: alarmReached(station, reference) }];
  });
}
