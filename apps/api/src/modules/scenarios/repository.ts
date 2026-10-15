import path from 'node:path';
import type { Pool } from 'pg';
import {
  formatScenarioTime,
  type FloodImpacts,
  type FloodPlanRow,
  type FloodScenarioDetail,
  type FloodScenarioId,
  type FloodScenarioSummary,
} from '@webatlas/shared';
import { config } from '../../config/env';

/**
 * The one place that reads the `scenario` schema, which
 * packages/atlas-data/tools/flood_scenario/build_scenarios.py rebuilds whole. The routes and the
 * assistant's flood tools both read through here.
 */

/** Postgres "undefined_table": the build script has never run on this machine. */
const UNDEFINED_TABLE = '42P01';

interface ScenarioRow {
  id: FloodScenarioId;
  name: string;
  kind: 'kttv' | 'preset';
  rain_total_mm: number | null;
  start_time: Date;
  hours: number;
  bulletin_hour: number;
  basis: string;
  frame_extent: number[];
}

function summary(r: ScenarioRow): FloodScenarioSummary {
  return {
    id: r.id, name: r.name, kind: r.kind, rainTotalMm: r.rain_total_mm,
    startTime: r.start_time.toISOString(), hours: r.hours, bulletinHour: r.bulletin_hour, basis: r.basis,
  };
}

const SCENARIO_COLUMNS = 'id, name, kind, rain_total_mm, start_time, hours, bulletin_hour, basis, frame_extent';

export async function listScenarios(pool: Pool): Promise<FloodScenarioSummary[]> {
  try {
    const { rows } = await pool.query<ScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS} FROM scenario.flood_scenario
        ORDER BY array_position(ARRAY['kttv-2025-10','preset-500','preset-1000','preset-1300'], id)`
    );
    return rows.map(summary);
  } catch (e) {
    if ((e as { code?: string }).code === UNDEFINED_TABLE) return [];
    throw e;
  }
}

async function scenarioRow(pool: Pool, id: FloodScenarioId): Promise<ScenarioRow | null> {
  try {
    const { rows } = await pool.query<ScenarioRow>(`SELECT ${SCENARIO_COLUMNS} FROM scenario.flood_scenario WHERE id = $1`, [id]);
    return rows[0] ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === UNDEFINED_TABLE) return null;
    throw e;
  }
}

export async function getScenario(pool: Pool, id: FloodScenarioId): Promise<FloodScenarioDetail | null> {
  const row = await scenarioRow(pool, id);
  if (!row) return null;
  const [stations, series, hourly] = await Promise.all([
    pool.query(
      `SELECT id, name, river, bd1, bd2, bd3, record_m, record_year, derived FROM scenario.flood_station
        ORDER BY array_position(ARRAY['ai-nghia','cau-lau','hoi-an','giao-thuy'], id)`
    ),
    pool.query<{ station_id: string; hour: number; level_m: number; forecast_m: number | null }>(
      'SELECT station_id, hour, level_m, forecast_m FROM scenario.flood_series WHERE scenario_id = $1 ORDER BY station_id, hour',
      [id]
    ),
    pool.query<{ flooded_km2: number }>(
      'SELECT flooded_km2 FROM scenario.flood_hourly WHERE scenario_id = $1 ORDER BY hour',
      [id]
    ),
  ]);
  const bySeries: FloodScenarioDetail['series'] = {};
  for (const r of series.rows) {
    const s = (bySeries[r.station_id] ??= { level: [], forecast: [] });
    s.level[r.hour] = r.level_m;
    s.forecast[r.hour] = r.forecast_m;
  }
  return {
    ...summary(row),
    stations: stations.rows.map((s) => ({
      id: s.id, name: s.name, river: s.river, bd1: s.bd1, bd2: s.bd2, bd3: s.bd3,
      recordM: s.record_m, recordYear: s.record_year === null ? null : Number(s.record_year), derived: s.derived,
    })),
    series: bySeries,
    floodedKm2: hourly.rows.map((r) => r.flooded_km2),
    frameExtent: row.frame_extent as [number, number, number, number],
  };
}

export function clampHour(hour: number, hours: number): number {
  return Math.min(Math.max(Math.trunc(hour), 0), hours);
}

export async function getImpacts(pool: Pool, id: FloodScenarioId, hour: number): Promise<FloodImpacts | null> {
  const row = await scenarioRow(pool, id);
  if (!row) return null;
  const h = clampHour(hour, row.hours);
  const start = row.start_time.toISOString();
  const [roads, wards] = await Promise.all([
    pool.query(
      `SELECT name, ref, fclass, cut_hour, max_depth FROM scenario.flood_road
        WHERE scenario_id = $1 AND cut_hour <= $2 ORDER BY cut_hour, name NULLS LAST`,
      [id, h]
    ),
    pool.query(
      `SELECT ward_code, ward_name, first_hour, buildings_flooded, people_est, max_depth FROM scenario.flood_ward
        WHERE scenario_id = $1 AND first_hour <= $2 ORDER BY first_hour, ward_name`,
      [id, h]
    ),
  ]);
  const wardRows = wards.rows.map((w) => ({
    code: w.ward_code, name: w.ward_name, firstHour: w.first_hour, firstTime: formatScenarioTime(start, w.first_hour),
    buildingsFlooded: w.buildings_flooded, peopleEst: w.people_est, maxDepth: w.max_depth,
  }));
  return {
    hour: h,
    time: formatScenarioTime(start, h),
    // Unnamed segments are counted in the totals but not listed: a list of "đường không tên" helps no one.
    roads: roads.rows.filter((r) => r.name !== null).map((r) => ({
      name: r.name, ref: r.ref, fclass: r.fclass, cutHour: r.cut_hour, cutTime: formatScenarioTime(start, r.cut_hour),
      maxDepth: r.max_depth,
    })),
    wards: wardRows,
    totals: {
      roadsCut: roads.rows.length,
      wardsWet: wardRows.length,
      buildingsFlooded: wardRows.reduce((n, w) => n + w.buildingsFlooded, 0),
      peopleEst: wardRows.reduce((n, w) => n + w.peopleEst, 0),
    },
  };
}

export async function getPlan(pool: Pool, id: FloodScenarioId): Promise<FloodPlanRow[] | null> {
  const row = await scenarioRow(pool, id);
  if (!row) return null;
  const start = row.start_time.toISOString();
  const { rows } = await pool.query(
    `SELECT p.priority, p.ward_code, w.ward_name, w.deadline_hour, w.first_hour, w.people_est,
            s.id AS shelter_id, s.name AS shelter_name, s.kind AS shelter_kind,
            ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, p.distance_m, p.open_roads,
            ST_AsGeoJSON(p.arrow, 6)::json AS arrow
       FROM scenario.flood_plan p
       JOIN scenario.flood_ward w ON w.scenario_id = p.scenario_id AND w.ward_code = p.ward_code
       JOIN scenario.shelter s ON s.id = p.shelter_id
      WHERE p.scenario_id = $1
      ORDER BY p.priority`,
    [id]
  );
  return rows.map((r) => ({
    priority: r.priority, wardCode: r.ward_code, wardName: r.ward_name,
    deadlineHour: r.deadline_hour, deadlineTime: formatScenarioTime(start, r.deadline_hour),
    alreadyWet: r.first_hour === 0, peopleEst: r.people_est,
    shelter: { id: r.shelter_id, name: r.shelter_name, kind: r.shelter_kind, lonLat: [r.lon, r.lat] },
    distanceM: r.distance_m, openRoads: r.open_roads ?? [], arrow: r.arrow,
  }));
}

/** Every road segment the scenario cuts, with the hour it is cut: the map colours them by the slider hour. */
export async function getRoads(pool: Pool, id: FloodScenarioId): Promise<unknown | null> {
  const row = await scenarioRow(pool, id);
  if (!row) return null;
  const { rows } = await pool.query(
    `SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geom, 5)::json,
              'properties', json_build_object('cutHour', cut_hour, 'name', name)
            ) ORDER BY cut_hour), '[]'::json)) AS fc
       FROM scenario.flood_road WHERE scenario_id = $1`,
    [id]
  );
  return rows[0].fc;
}

/** Where the build script writes frames; FLOOD_FRAMES_DIR overrides it. */
export function framesDir(): string {
  return config.FLOOD_FRAMES_DIR ?? path.resolve(process.cwd(), '../../packages/atlas-data/data/cache/flood/frames');
}

/** Only ever called with a validated id and integer hour, so the path cannot leave framesDir. */
export function framePath(id: FloodScenarioId, hour: number): string {
  return path.join(framesDir(), id, `${String(hour).padStart(3, '0')}.png`);
}
