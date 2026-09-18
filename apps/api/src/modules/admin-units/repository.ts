import type { Pool } from 'pg';

export interface AdminUnit {
  code: string;
  name: string;
  fullName: string | null;
  level: 'province' | 'ward';
  /** [west, south, east, north] in EPSG:4326. */
  bbox: [number, number, number, number];
}

interface Row {
  code: string;
  name: string;
  fullName: string | null;
  west: number; south: number; east: number; north: number;
}

const BBOX_SQL = `ST_XMin(ST_Envelope(geom)) AS west, ST_YMin(ST_Envelope(geom)) AS south,
                  ST_XMax(ST_Envelope(geom)) AS east, ST_YMax(ST_Envelope(geom)) AS north`;

function toUnit(level: AdminUnit['level']) {
  return (r: Row): AdminUnit => ({
    code: r.code, name: r.name, fullName: r.fullName, level,
    bbox: [r.west, r.south, r.east, r.north],
  });
}

export async function listProvinces(pool: Pool): Promise<AdminUnit[]> {
  const { rows } = await pool.query<Row>(
    `SELECT code, name, full_name AS "fullName", ${BBOX_SQL} FROM admin.provinces ORDER BY code`
  );
  return rows.map(toUnit('province'));
}

export async function listWards(pool: Pool, provinceCode: string): Promise<AdminUnit[]> {
  const { rows } = await pool.query<Row>(
    `SELECT code, name, full_name AS "fullName", ${BBOX_SQL} FROM admin.wards
      WHERE province_code = $1 ORDER BY code`,
    [provinceCode]
  );
  return rows.map(toUnit('ward'));
}
