import type { Queryable } from '../assistant/tools/data/helpers';

export const DEM_UNAVAILABLE_SUMMARY = { 'Trạng thái': 'Chưa nạp dữ liệu độ cao' } as const;

/**
 * Checked up front with to_regclass rather than by catching 42P01: the analysis runs
 * inside a transaction, and a caught error there aborts it — every later statement
 * would fail with 25P02. A deployment that never ran the DEM runbook is an ordinary
 * outcome (200 + status), not an error.
 */
export async function demAvailable(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`SELECT to_regclass('basemap.dem_region') IS NOT NULL AS ok`);
  return rows[0].ok;
}
